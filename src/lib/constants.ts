export const APP_NAME = "Gestão Comercial";
export const APP_TAGLINE = "Vendas, estoque e financeiro com clareza.";

export const PAYMENT_METHODS = [
  "dinheiro",
  "pix",
  "debito",
  "credito",
  "crediario",
  "vale",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  debito: "Cartão de débito",
  credito: "Cartão de crédito",
  crediario: "Crediário",
  vale: "Vale",
};

export const CARD_BRANDS = ["Visa", "Mastercard", "Elo", "Amex", "Hipercard"] as const;

export const SALE_STATUS = ["finalizada", "cancelada", "devolvida", "devolvida_parcial"] as const;
export const SALE_STATUS_LABELS: Record<string, string> = {
  finalizada: "Finalizada",
  cancelada: "Cancelada",
  devolvida: "Devolvida",
  devolvida_parcial: "Devolução parcial",
  aberta: "Aberta",
};

export const PURCHASE_STATUS = [
  "orcamento",
  "pedido",
  "aprovado",
  "enviado",
  "recebido",
  "cancelado",
] as const;
export const PURCHASE_STATUS_LABELS: Record<string, string> = {
  orcamento: "Orçamento",
  pedido: "Pedido",
  aprovado: "Aprovado",
  enviado: "Enviado",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

export const ACCOUNT_STATUS = ["pendente", "pago", "vencido", "parcial", "cancelado"] as const;
export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago",
  vencido: "Vencido",
  parcial: "Parcial",
  cancelado: "Cancelado",
};

export const STOCK_TYPES = [
  "entrada",
  "saida",
  "venda",
  "compra",
  "devolucao",
  "perda",
  "ajuste",
  "transferencia",
] as const;
export const STOCK_TYPE_LABELS: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  venda: "Venda",
  compra: "Compra",
  devolucao: "Devolução",
  perda: "Perda",
  ajuste: "Ajuste",
  transferencia: "Transferência",
};

export const CRM_STAGES = [
  "novo",
  "interessado",
  "orcamento",
  "negociacao",
  "venda",
  "perdido",
] as const;
export type CrmStage = (typeof CRM_STAGES)[number];
export const CRM_STAGE_LABELS: Record<CrmStage, string> = {
  novo: "Novo contato",
  interessado: "Interessado",
  orcamento: "Orçamento",
  negociacao: "Negociação",
  venda: "Venda",
  perdido: "Perdido",
};

export const UNITS = ["UN", "KG", "G", "L", "ML", "CX", "PC", "M", "PAR"] as const;

export const PROMO_KINDS = [
  "percent",
  "fixed",
  "promo_price",
  "bxgy",
  "qty",
] as const;
export const PROMO_KIND_LABELS: Record<string, string> = {
  percent: "Desconto percentual",
  fixed: "Desconto fixo",
  promo_price: "Preço promocional",
  bxgy: "Leve X pague Y",
  qty: "Desconto por quantidade",
};

export const COMMISSION_KIND_LABELS: Record<string, string> = {
  percent_sales: "Sobre o faturamento",
  percent_profit: "Sobre o lucro",
  fixed_unit: "Valor fixo por peça",
  exclude: "Sem comissão",
};

export const TIER_BASIS_LABELS: Record<string, string> = {
  none: "Percentual único",
  sale: "Faixa sobre o total da venda",
  month: "Faixa sobre o faturamento do mês",
};

export const TARGET_BONUS_KINDS = ["none", "extra_percent", "extra_fixed"] as const;
export type TargetBonusKind = (typeof TARGET_BONUS_KINDS)[number];
export const TARGET_BONUS_LABELS: Record<TargetBonusKind, string> = {
  none: "Sem bônus de comissão",
  extra_percent: "+% sobre a venda ao bater a meta",
  extra_fixed: "Valor fixo ao cruzar a meta",
};
export function isTargetBonusKind(value: string): value is TargetBonusKind {
  return (TARGET_BONUS_KINDS as readonly string[]).includes(value);
}

export const CASH_MOVE_LABELS: Record<string, string> = {
  venda: "Venda",
  sangria: "Sangria",
  suprimento: "Suprimento",
  cancelamento: "Cancelamento",
  abertura: "Abertura",
  fechamento: "Fechamento",
  devolucao: "Devolução",
};

export const CASH_ACCOUNT_KINDS = ["caixa", "banco", "pix", "cartao", "carteira"] as const;
export const CASH_ACCOUNT_LABELS: Record<string, string> = {
  caixa: "Caixa",
  banco: "Conta bancária",
  pix: "PIX",
  cartao: "Cartão",
  carteira: "Carteira",
};

export const RETURN_KINDS = ["total", "parcial", "troca"] as const;
export const RETURN_KIND_LABELS: Record<string, string> = {
  total: "Devolução total",
  parcial: "Devolução parcial",
  troca: "Troca",
};

export const EXPENSE_CATEGORIES = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet",
  "Folha",
  "Marketing",
  "Impostos",
  "Manutenção",
  "Transporte",
  "Outros",
] as const;
