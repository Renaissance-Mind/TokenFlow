// Shared by Settings and the canonical Dashboard's editor overlay.
export const defaultWidgets=['overview','trend','models'];
export const widgetCatalog=[
  {id:'overview',icon:'grid',en:['Usage overview','Tokens, cost and daily averages'],zh:['用量总览','Token、费用与每日平均用量']},
  {id:'trend',icon:'bar-chart-2',en:['Daily trend','Usage over your selected time range'],zh:['每日趋势','所选时间范围内的用量走势']},
  {id:'models',icon:'bar-chart-2',en:['Model distribution','Your top models by cost'],zh:['模型分布','费用最高的模型与占比']},
  {id:'activity',icon:'grid',en:['Token activity','Your activity across the year'],zh:['Token 活跃度','全年用量与活跃节奏']},
  {id:'composition',icon:'pie-chart',en:['Token mix','Input, cache and output breakdown'],zh:['Token 构成','输入、缓存与输出的组成']},
  {id:'devices',icon:'monitor',en:['Device distribution','Usage across your computers'],zh:['设备分布','各台电脑的用量占比']},
  {id:'cache',icon:'percent',en:['Cache hit rate','Cached tokens as a share of input'],zh:['缓存命中率','输入 Token 中缓存的比例']},
  {id:'output',icon:'arrow-up-right',en:['Output tokens','Output and reasoning tokens'],zh:['输出 Token','输出与推理 Token 的用量']},
];
export function widgetCopy(id,language){return widgetCatalog.find(item=>item.id===id)?.[language==='zh'?'zh':'en']||[id,''];}
