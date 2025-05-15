import "dotenv/config";
import { anthropic, createAgent, createNetwork, createTool } from "@inngest/agent-kit";
import { createServer } from "@inngest/agent-kit/server";
import { Inngest } from "inngest";
import { z } from "zod";
import { type ToolCallMessage, type Tool } from "@inngest/agent-kit";
// import { type StateData } from "@inngest/agent-kit/src/state";
// import express from "express";

const apaiUrl = "http://localhost:9000/sse";

// 1) idempotent MCP-backed tool for getAgreement
const getAgreementTool = createTool({
  name: "apai-getAgreement",
  description: "Retrieves the full data of an agreement (idempotent)",
  parameters: z.object({
    agreementId: z.string().describe("ID of the agreement to fetch"),
  }),
  // note the context now includes `step`
  handler: async (
    { agreementId },
    { step }  // destructure step from the context
  ) => {
    // Wrap the real MCP call in step.run so it only ever runs once per agreementId
    return await step?.run(`getAgreement-${agreementId}`, async () => {
      // --- your actual SSE streaming / MCP call logic here ---
      // For example, if you had a helper:
      // const resp = await callApaiSSE("getAgreement", { agreementId });
      // return resp.data;
      // But since Agent‐Kit handles streaming automatically for you,
      // you might simply return a success stub here and let the SDK inject the streaming:
      return { success: true };
    });
  },
  mcp: {
    server: {
      name: "apai",
      transport: { type: "sse" as const, url: apaiUrl },
    },
    tool: { name: "getAgreement" },
  },
});

const getTemplateTool = createTool({
  name: "apai-getTemplate",
  description: "Retrieves the full data of a template",
  parameters: z.object({
    templateId: z.string().describe("ID of the template to fetch"),
  }),
  mcp: {
    server: {
      name: "apai",
      transport: { type: "sse" as const, url: apaiUrl },
    },
    tool: { name: "getTemplate" },
  },
  handler: async (_args) => {
    // no-op stub
    return { success: true };
  },
});

// 2) your done tool can also be guarded if needed (often not necessary)
const done = createTool({
  name: "done",
  description: "Finish the task (idempotent)",
  parameters: z.object({ answer: z.string() }),
  handler: async (
    { answer },
    { step, network }
  ) => {
    // ensure done only runs once per run
    return await step?.run("done", async () => {
      network?.state.kv?.set("answer", answer);
      return answer;
    });
  },
});

const agent = createAgent({
  name: "apai-agent",
  system: `You are a helpful assistant that helps manage smart legal contracts using the APAI API.

Available tools:
- apai-getAgreement: Retrieves the full data of an agreement
- apai-getTemplate: Retrieves the full data of a template
- done: Call this when you have completed the task or if you encounter an error

IMPORTANT: 
1. You MUST use the MCP tools (apai-getAgreement or apai-getTemplate) to gather the necessary data first
2. You may need to use multiple tool calls to gather all required information
3. After receiving tool responses, analyze the data to determine the answer to the user's question
4. Once you have determined the answer, call the 'done' tool with a clear, concise response
5. The 'done' tool requires an 'answer' parameter - this should be your final response to the user
6. If you encounter any errors or can't find the requested information, call 'done' with an appropriate error message
7. NEVER call 'done' without first gathering and analyzing the necessary data
8. Make no assumptions about the data structure - analyze what you receive from the tools
9. Focus on answering the user's specific question using the data you gather`,
  tools: [getAgreementTool, getTemplateTool, done],
  mcpServers: [{ name: "apai", transport: { type: "sse", url: apaiUrl } }]
});

const apaiAgentNetwork = createNetwork({
  name: "apai-network",
  agents: [agent],
  defaultModel: anthropic({ model: "claude-3-5-sonnet-20240620", defaultParameters: { max_tokens: 1000 } })
});

// This wires up a Cloud function that the Console will invoke:
const inngestClient = new Inngest({ id: "apai-agent-network" });
export const apaiAgentFunction = inngestClient.createFunction(
  {  
    id: "apai-agent",         // this must match the Console function ID
    name: "APAI Agent",
    retries: 0,
    concurrency: 1,
    idempotency: "event._inngest.gid"
  },
  { event: "apai/request" },
  async ({ event }) => {
    console.log("apaiAgentFunction invoked with:", event.data.input);
    const networkRun = await apaiAgentNetwork.run(event.data.input);
    const inference = networkRun.state.results[networkRun.state.results.length - 1];
    console.log("🦾 Agent output:", inference.output);
    // Find the `done` tool_call in the final output
    const doneCall = inference.output?.find(
      m => m.type === "tool_call" && m.tools?.[0]?.name === "done"
    ) as ToolCallMessage | undefined;
    if (doneCall) {
      console.log("✅ Done call answer:", doneCall.tools[0].input.answer);
      // Unwrap and return just the answer string
      return { answer: doneCall.tools[0].input.answer };
    }

    // Fallback: return whatever text the agent emitted
    const texts = inference.output
      ?.filter(m => m.type === "text")
      .map(m => m.content)
      .join("\n");
    return { answer: texts || "No answer generated." };
    // console.log("🦾 Agent output:", lastResult?.output);
    // console.log("All done:", lastResult?.output);
    // return lastResult;
  }
);


// Create a bare express app to capture all routes:
// const app = express();
// app.use(express.json());  // parse JSON bodies
// app.use((req, res, next) => {
//   console.log("🔔 Received HTTP request:", req.method, req.originalUrl);
//   next();
// });

const server = createServer({
  
  networks: [apaiAgentNetwork],
  appId: "apai-agent-network",
  functions:  [apaiAgentFunction]
});

server.listen(3010, () => console.log("Listening on :3010"));