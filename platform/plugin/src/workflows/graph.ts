import { END, START, StateGraph } from '@langchain/langgraph'

/** 组合和生成工作流共用顺序图编译；节点状态、条件和错误语义由调用方维护。 */
export function compileSequence(annotation: any, nodes: { id: string; run(state: any): any; metadata?: Record<string, any> }[]) {
  if (!nodes.length) throw new Error('顺序图至少需要一个节点')
  let builder: any = new StateGraph(annotation)
  for (const node of nodes) builder = builder.addNode(node.id, node.run, node.metadata ? { metadata: node.metadata } : undefined)
  for (let index = 0; index < nodes.length; index++) builder = builder.addEdge(index ? nodes[index - 1].id : START, nodes[index].id)
  return builder.addEdge(nodes.at(-1)!.id, END).compile({ checkpointer: false })
}
