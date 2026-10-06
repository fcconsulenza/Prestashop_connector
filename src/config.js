export const stores = [
  { id: "adipietro", name: "Adipietro Commerciale", baseUrl: "https://adipietro.it", keyEnv: "PS_KEY_ADIPIETRO", fee: 3 },
  { id: "cartoschool", name: "Cartoschool", baseUrl: "https://www.cartoschool.it", keyEnv: "PS_KEY_CARTOSCHOOL", fee: 3 },
  { id: "le3c", name: "Le 3C Giocattoli", baseUrl: "https://www.le3cgiocattoli.com", keyEnv: "PS_KEY_LE3C", fee: 3 },
  { id: "balita", name: "Balita Store", baseUrl: "https://www.balitastore.it", keyEnv: "PS_KEY_BALITA", fee: 3 }
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
