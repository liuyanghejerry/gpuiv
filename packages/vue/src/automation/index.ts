/// GPUIX Playwright-like automation API.

export {
  App,
  connectStdio,
  connectTest,
  handleAutomationRequest,
  InProcessBackend,
  launch,
  liveRendererAsTest,
  Locator,
  serveAutomationStdio,
  SseBackend,
} from "./client.js"
export type {
  AutomationBackend,
  ComponentInspector,
  DragOptions,
  LiveAutomationRenderer,
  MouseOptions,
  PointTarget,
  TestAutomationRenderer,
} from "./client.js"
export { createComponentInspector } from "./component-inspector.js"
export {
  AutomationError,
  createSseDecoder,
  decodeSseChunk,
  encodeSse,
  methods,
  parseRequest,
  parseResponse,
  parseWireMessage,
  PROTOCOL_VERSION,
} from "./protocol.js"
export type {
  AutomationErrorCode,
  AutomationRequest,
  AutomationResponse,
  AutomationServerEvent,
  ComponentTreeNode,
  SerializedValue,
  ElementBounds,
  MethodName,
  ParamsOf,
  ResultOf,
  TreeNode,
  WireMessage,
} from "./protocol.js"
