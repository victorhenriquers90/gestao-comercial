import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyBackupAge,
  formatBackupAge,
  parseBackupState,
  HORAS_ATE_ATRASADO,
  HORAS_ATE_CRITICO,
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
    const r = parseBackupState("﻿" + conteudo);
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
