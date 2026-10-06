export const stores = [
  { id: "adipietro", name: "Adipietro Commerciale", baseUrl: "https://adipietro.it", keyEnv: "PS_KEY_ADIPIETRO", fee: 3 },
  { id: "cartoschool", name: "Cartoschool", baseUrl: "https://cartoschool.it", keyEnv: "PS_KEY_CARTOSCHOOL", fee: 3 },
  { id: "le3c", name: "Le 3C Giocattoli", baseUrl: "https://le3cgiocattoli.com", keyEnv: "PS_KEY_LE3C", fee: 3 },
  { id: "balita", name: "Balita Store", baseUrl: "https://balitastore.it", keyEnv: "PS_KEY_BALITA", fee: 3 },
  { id: "lacartoleria", name: "laCartoleria", baseUrl: "https://www.lacartoleria.it", keyEnv: "PS_KEY_LACARTOLERIA", fee: null },
  { id: "parafarmaciabembo", name: "Parafarmacia Bembo", baseUrl: "https://parafarmaciabembo.it", keyEnv: "PS_KEY_PARAFARMACIABEMBO", fee: null },
  { id: "silvanabomboniere", name: "Silvana Bomboniere", baseUrl: "https://silvanabomboniere.it", keyEnv: "PS_KEY_SILVANABOMBONIERE", fee: null },
  { id: "idecorativi", name: "I Decorativi", baseUrl: "https://idecorativi.it", keyEnv: "PS_KEY_IDECORATIVI", fee: null },
  { id: "golamifa", name: "Golamifa", baseUrl: "https://www.golamifa.it", keyEnv: "PS_KEY_GOLAMIFA", fee: null },
  { id: "presepiale", name: "Presepiale", baseUrl: "https://presepiale.it", keyEnv: "PS_KEY_PRESEPIALE", fee: null },
  { id: "frameinterni", name: "Frame Interni", baseUrl: "https://frameinterni.com", keyEnv: "PS_KEY_FRAMEINTERNI", fee: null },
  { id: "provenzalemotorstore", name: "Provenzale Motor Store", baseUrl: "https://provenzalemotorstore.it", keyEnv: "PS_KEY_PROVENZALEMOTORSTORE", fee: null }
];

export const cfg = {
  port: Number(process.env.PORT || 3000),
  bearer: process.env.MCP_BEARER_TOKEN || "",
  maxPage: Math.min(Number(process.env.MAX_PAGE_SIZE || 100), 250),
  maxOrders: Math.min(Number(process.env.MAX_ORDER_SCAN || 5000), 20000)
};

export function getStore(id) {
  const s = stores.find(x => x.id === id);
  if (!s) throw new Error("Unknown store_id");
  const apiKey = process.env[s.keyEnv];
  if (!apiKey) throw new Error(`Store ${s.name} is not configured`);
  return { ...s, apiKey };
}
