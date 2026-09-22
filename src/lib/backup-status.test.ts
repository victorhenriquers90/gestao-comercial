import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyBackupAge,
  formatBackupAge,
  parseBackupState,
  HORAS_ATE_ATRASADO,
  HORAS_ATE_CRITICO,
  classifySecondary,
} from "./backup-status.ts";

const agora = new Date("2026-09-19T14:00:00-03:00");
const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000).toISOString();

describe("classifyBackupAge", () => {
  it("backup de algumas horas atras esta ok", () => {
    const r = classifyBackupAge(horasAtras(3), agora);
    assert.equal(r.severity, "ok");
    assert.ok(r.ageHours !== null && Math.abs(r.ageHours - 3) < 0.01);
  });

  it("loja fechada no domingo (backup de sabado) NAO vira aviso", () => {
    // O caso que motivou o limite de 48h: avisar aqui ensinaria o lojista
    // a ignorar o aviso.
    assert.equal(classifyBackupAge(horasAtras(40), agora).severity, "ok");
  });

  it("a partir de 48h vira atrasado", () => {
    assert.equal(classifyBackupAge(horasAtras(HORAS_ATE_ATRASADO), agora).severity, "atrasado");
    assert.equal(classifyBackupAge(horasAtras(HORAS_ATE_ATRASADO - 0.1), agora).severity, "ok");
  });

  it("uma semana sem backup e critico", () => {
    assert.equal(classifyBackupAge(horasAtras(HORAS_ATE_CRITICO), agora).severity, "critico");
    assert.equal(classifyBackupAge(horasAtras(HORAS_ATE_CRITICO - 1), agora).severity, "atrasado");
  });

  it("sem arquivo / sem data e desconhecido, nunca ok", () => {
    assert.equal(classifyBackupAge(null, agora).severity, "desconhecido");
    assert.equal(classifyBackupAge(undefined, agora).severity, "desconhecido");
    assert.equal(classifyBackupAge("", agora).severity, "desconhecido");
    assert.equal(classifyBackupAge("qualquer coisa", agora).severity, "desconhecido");
  });

  it("data no futuro nao vira atestado de saude", () => {
    // Relogio da maquina adiantado ou arquivo adulterado: nao da pra
    // afirmar que o backup esta em dia, entao nao afirmamos.
    const futuro = new Date(agora.getTime() + 48 * 3_600_000).toISOString();
    assert.equal(classifyBackupAge(futuro, agora).severity, "desconhecido");
  });

  it("tolera desvio de relogio de ate uma hora", () => {
    // Pequena diferenca entre o relogio de quem gravou e o de quem le e
    // normal; tratar como "desconhecido" seria alarme falso.
    const poucoAdiantado = new Date(agora.getTime() + 10 * 60_000).toISOString();
    assert.equal(classifyBackupAge(poucoAdiantado, agora).severity, "ok");
  });
});

describe("parseBackupState", () => {
  const conteudo = `{
    "lastBackupAt": "2026-09-19T14:43:54.4517509-03:00",
    "file": "gestao_comercial_20260919_144353.dump",
    "sizeBytes": 210530
}`;

  it("le o arquivo como o PowerShell grava", () => {
    const r = parseBackupState(conteudo);
    assert.equal(r?.file, "gestao_comercial_20260919_144353.dump");
    assert.equal(r?.sizeBytes, 210530);
    assert.equal(classifyBackupAge(r?.lastBackupAt, new Date("2026-09-19T16:00:00-03:00")).severity, "ok");
  });

  it("le o arquivo COM BOM", () => {
    // O bug real: Set-Content -Encoding UTF8 no Windows PowerShell 5.1 (que
    // e o que a tarefa agendada roda) grava BOM, e JSON.parse lanca com BOM.
    // Sem isto, uma loja com backup em dia era reportada como "nunca houve
    // backup" -- alarme falso, que e como se ensina a ignorar alarme.
    const r = parseBackupState(String.fromCharCode(0xfeff) + conteudo);
    assert.equal(r?.file, "gestao_comercial_20260919_144353.dump");
  });

  it("devolve null em vez de chutar quando o arquivo esta corrompido", () => {
    assert.equal(parseBackupState("{ isso nao e json"), null);
    assert.equal(parseBackupState(""), null);
    assert.equal(parseBackupState("null"), null);
  });

  it("ignora campos com tipo errado em vez de propagar lixo", () => {
    const r = parseBackupState('{"lastBackupAt": 12345, "sizeBytes": "grande"}');
    assert.equal(r?.lastBackupAt, null);
    assert.equal(r?.sizeBytes, null);
    assert.equal(classifyBackupAge(r?.lastBackupAt).severity, "desconhecido");
  });
});

describe("formatBackupAge", () => {
  it("descreve a idade em portugues", () => {
    assert.equal(formatBackupAge(null), "nunca");
    assert.equal(formatBackupAge(0.4), "há menos de uma hora");
    assert.equal(formatBackupAge(1), "há 1 hora");
    assert.equal(formatBackupAge(5.9), "há 5 horas");
    assert.equal(formatBackupAge(24), "há 1 dia");
    assert.equal(formatBackupAge(50), "há 2 dias");
  });
});

describe("classifySecondary", () => {
  const agora = new Date("2026-09-22T12:00:00-03:00");
  const base = { dir: "D:\backups-gestao", ok: true, lastOkAt: null, error: null };

  it("não configurada não é problema — é ausência", () => {
    const s = classifySecondary(null, agora);
    assert.equal(s.configurada, false);
    assert.equal(s.severity, "desconhecido");
  });

  it("copiada hoje: em dia", () => {
    const s = classifySecondary({ ...base, lastOkAt: "2026-09-22T11:00:00-03:00" }, agora);
    assert.equal(s.severity, "ok");
    assert.equal(s.dir, "D:\backups-gestao");
  });

  it("configurada e nunca funcionou é CRÍTICO, não 'desconhecido'", () => {
    // Pior que não ter: alguém acredita que existe cópia fora da máquina.
    const s = classifySecondary({ ...base, ok: false, error: "drive Z inexistente" }, agora);
    assert.equal(s.severity, "critico");
    assert.equal(s.error, "drive Z inexistente");
  });

  it("falhou hoje avisa hoje, sem esperar as 48h da idade", () => {
    // O backup local está em dia e a cópia quebrou ontem à noite: esperar a
    // idade passar de 48h seria um dia a menos pra consertar.
    const s = classifySecondary(
      { ...base, ok: false, lastOkAt: "2026-09-21T22:30:00-03:00", error: "pendrive removido" },
      agora,
    );
    assert.equal(s.severity, "atrasado");
  });

  it("parada há mais de uma semana é crítico", () => {
    const s = classifySecondary({ ...base, lastOkAt: "2026-09-10T22:30:00-03:00" }, agora);
    assert.equal(s.severity, "critico");
  });

  it("o backup local em dia não salva a cópia externa parada", () => {
    // O ponto de existirem duas severidades: uma verde não pode esconder a
    // outra vermelha.
    const local = classifyBackupAge("2026-09-22T11:00:00-03:00", agora);
    const externa = classifySecondary({ ...base, lastOkAt: "2026-09-05T22:30:00-03:00" }, agora);
    assert.equal(local.severity, "ok");
    assert.equal(externa.severity, "critico");
  });
});

describe("parseBackupState com cópia externa", () => {
  it("lê o bloco secondary gravado pelo PowerShell", () => {
    const bruto = JSON.stringify({
      lastBackupAt: "2026-09-22T12:13:45-03:00",
      file: "gestao_comercial_20260922_121344.dump",
      sizeBytes: 227801,
      secondary: {
        dir: "D:\backups-gestao",
        ok: true,
        lastOkAt: "2026-09-22T12:13:45-03:00",
        error: "",
      },
    });
    const s = parseBackupState(bruto)!;
    assert.equal(s.secondary?.dir, "D:\backups-gestao");
    assert.equal(s.secondary?.ok, true);
    // "" vem do PowerShell quando o parâmetro [string] não foi preenchido:
    // é ausência de erro, não um erro sem texto.
    assert.equal(s.secondary?.error, null);
  });

  it("instalação sem cópia externa: secondary null, não erro", () => {
    const bruto = JSON.stringify({ lastBackupAt: "2026-09-22T12:00:00-03:00" });
    assert.equal(parseBackupState(bruto)?.secondary, null);
  });

  it("bloco secondary sem dir é ignorado", () => {
    const bruto = JSON.stringify({ lastBackupAt: "x", secondary: { ok: true } });
    assert.equal(parseBackupState(bruto)?.secondary, null);
  });
});
