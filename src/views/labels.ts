import type { ContactStatus, Origem } from '../db/schema.js';

export const ORIGEM_LABEL: Record<Origem, string> = {
  anuncio: 'Anúncio',
  site: 'Site',
  maps: 'Google Maps',
  indicacao: 'Indicação',
  passou_na_frente: 'Passou na frente',
  desconhecida: 'Desconhecido',
};

export const STATUS_LABEL: Record<ContactStatus, string> = {
  aberto: 'Aberto',
  orcamento: 'Orçamento',
  vendeu: 'Vendeu',
  nao_comprou: 'Não comprou',
};

/** What the client may pick when asking "como conheceu?"; "anuncio" only comes from tracking. */
export const ORIGENS_MANUAIS: Origem[] = ['site', 'maps', 'indicacao', 'passou_na_frente', 'desconhecida'];
