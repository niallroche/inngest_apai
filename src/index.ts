/* eslint-disable */
import "dotenv/config";
import {
  anthropic,
  createAgent,
  createNetwork,
  createTool,
  type InferenceResult,
  type ToolResultMessage
} from "@inngest/agent-kit";
import { createServer } from "@inngest/agent-kit/server";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import { Inngest } from "inngest";

const apaiUrl = "http://localhost:9000/sse"

// Generic tool for passing data between agents
const passDataTool = createTool({
  name: "pass_data",
  description: "Pass data between agents in the pipeline",
  parameters: z.object({
    data: z.any().describe("Data to pass to the next agent"),
    context: z.object({
      query: z.string().describe("The original user query"),
      tool: z.string().describe("The tool that provided the data"),
      timestamp: z.string().describe("When the data was retrieved")
    })
  }),
  handler: async ({ data, context }, { network }) => {
    if (network?.state.kv) {
      network.state.kv.set("current_data", data);
      network.state.kv.set("data_context", context);
    }
    return { success: true };
  }
});

// Generic tool for final responses
const doneTool = createTool({
  name: "done",
  description: "Call this tool when you are finished with the task.",
  parameters: z.object({
    answer: z.string().describe("Answer to the user's question.")
  }),
  handler: async ({ answer }, { network }) => {
    console.log("=== doneTool called ===");
    console.log("Answer provided:", answer);
    console.log("Answer length:", answer.length);
    console.log("Network state:", network?.state);
    if (network?.state.kv) {
      network.state.kv.set("answer", answer);
      console.log("Answer stored in network state");
    } else {
      console.log("Warning: No network state available to store answer");
    }
    return answer;
  }
});

// Remote APAI tools
const getAgreementTool = createTool({
  name: "apai-getAgreement",
  description: "Retrieves the full data of an agreement",
  mcp: {
    server: { 
      name: "apai",
      transport: {
        type: "sse",
        url: apaiUrl
      }
    },
    tool: { name: "getAgreement" }
  },
  parameters: z.object({
    agreementId: z.string().describe("ID of the agreement to fetch")
  }),
  handler: async ({ agreementId }) => {
    // The actual handling is done by the MCP server
    return { success: true };
  }
});

const getTemplateTool = createTool({
  name: "apai-getTemplate",
  description: "Retrieves the full data of a template",
  mcp: {
    server: { 
      name: "apai",
      transport: {
        type: "sse",
        url: apaiUrl
      }
    },
    tool: { name: "getTemplate" }
  },
  parameters: z.object({
    templateId: z.string().describe("ID of the template to fetch")
  }),
  handler: async ({ templateId }) => {
    // The actual handling is done by the MCP server
    return { success: true };
  }
});

const APAIAgent = createAgent({
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
  assistant: "",
  tools: [getAgreementTool, getTemplateTool, doneTool],
  mcpServers: [
    {
      name: "apai",
      transport: {
        type: "sse",
        url: apaiUrl
      }
    }
  ],
  lifecycle: {
    enabled: ({ network }) => {
      console.log("=== Agent Enabled Check ===");
      console.log("Network state:", network?.state);
      return true;
    },
    onStart: async ({ prompt, network }) => {
      console.log("=== Agent starting ===");
      console.log("Prompt:", prompt);
      console.log("Network state:", network?.state);
      
      // Log available tools
      console.log("\n=== Available Tools ===");
      console.log("Local tools:", Array.from(APAIAgent.tools.entries()).map(([name, tool]) => ({
        name,
        description: tool.description,
        mcp: tool.mcp ? {
          server: tool.mcp.server.name,
          tool: tool.mcp.tool.name
        } : null
      })));
      
      return { prompt, history: [], stop: false };
    },
    onResponse: async ({ result }) => {
      console.log("\n=== Agent Response Cycle ===");
      
      // Log the current state of the conversation
      console.log("\nCurrent History Length:", result.history?.length || 0);
      if (result.history?.length > 0) {
        console.log("\nLast few messages in history:");
        result.history.slice(-3).forEach((msg, index) => {
          console.log(`\nMessage ${index + 1}:`, {
            type: msg.type,
            role: msg.role,
            content: msg.type === 'tool_result' ? 'Tool result received' : undefined
          });
        });
      }

      // Log tool calls
      console.log("\nTool Calls:", result.toolCalls?.length || 0);
      if (result.toolCalls?.length > 0) {
        result.toolCalls.forEach((toolCall, index) => {
          console.log(`\nTool call ${index + 1}:`, {
            name: toolCall.tool.name,
            type: toolCall.type,
            content: toolCall.content
          });
        });
      }

      // Log agent's output
      console.log("\nAgent Output:");
      if (result.output?.length > 0) {
        result.output.forEach((msg, index) => {
          if (msg.type === 'text') {
            console.log(`\nOutput ${index + 1}:`, {
              type: msg.type,
              role: msg.role,
              stop_reason: msg.stop_reason,
              content: msg.content
            });
          } else if (msg.type === 'tool_call') {
            console.log(`\nTool Call ${index + 1}:`, {
              type: msg.type,
              role: msg.role,
              stop_reason: msg.stop_reason,
              tool: msg.tools?.[0]?.name,
              input: msg.tools?.[0]?.input
            });
          }
        });
      } else {
        console.log("No output in this response");
      }

      // Check for tool results
      if (result.history) {
        const toolResults = result.history.filter(msg => msg.type === 'tool_result');
        if (toolResults.length > 0) {
          console.log("\n=== Tool Results ===");
          toolResults.forEach((toolResult, index) => {
            console.log(`\nTool result ${index + 1}:`, {
              type: toolResult.type,
              tool: toolResult.tool?.name,
              content: toolResult.content
            });

            // If we have a tool result, we should continue the conversation
            if (toolResult.type === 'tool_result') {
              // Add the tool result to the history if it's not already there
              if (!result.history?.some(msg => 
                msg.type === 'tool_result' && 
                msg.tool?.name === toolResult.tool?.name
              )) {
                result.history.push(toolResult);
              }
              
              // If this was a getAgreement call, we should analyze the data
              if (toolResult.tool?.name === 'apai-getAgreement') {
                console.log("Agreement data received, continuing conversation...");
                // Add a final message to indicate completion
                result.history.push({
                  type: 'text',
                  role: 'assistant',
                  content: 'I have analyzed the agreement data and provided my response.'
                });
                // Add a done tool call to stop the conversation
                result.output = [{
                  type: 'tool_call',
                  role: 'assistant',
                  stop_reason: 'tool',
                  tools: [{
                    type: 'tool',
                    id: 'done',
                    name: 'done',
                    input: {
                      answer: 'I have analyzed the agreement data and will provide a response about the penalties.'
                    }
                  }]
                }];
                return result;
              }
            }
          });
        }
      }

      // If we have a done tool call, we should stop
      if (result.output?.some(msg => msg.type === 'tool_call' && msg.tools?.[0]?.name === 'done')) {
        console.log("Done tool called, stopping conversation");
        return result;
      }

      // If we have a tool call but no result yet, we should continue
      if (result.output?.some(msg => msg.type === 'tool_call') && !result.history?.some(msg => msg.type === 'tool_result')) {
        console.log("Tool call made but no result yet, continuing...");
        return result;
      }

      return result;
    }
  }
});

// Debug log for agent configuration
console.log("Agent configuration:", {
  name: APAIAgent.name,
  tools: Array.from(APAIAgent.tools.entries()).map(([name, tool]) => ({
    name,
    description: tool.description || "No description available",
    parameters: tool.parameters ? "Parameters defined" : "No parameters"
  })),
  system: APAIAgent.system
});

const apaiAgentNetwork = createNetwork({
  name: "apai-agent",
  agents: [APAIAgent],
  defaultModel: anthropic({
    model: "claude-3-5-sonnet-20240620",
    defaultParameters: {
      max_tokens: 1000,
    },
  }),
  defaultRouter: ({ network }) => {
    console.log("=== Network Router ===");
    console.log("Network state:", network?.state);
    
    // Log available tools
    console.log("Available tools:", Array.from(APAIAgent.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description,
      mcp: tool.mcp ? {
        server: tool.mcp.server.name,
        tool: tool.mcp.tool.name
      } : null
    })));
    
    // Initialize network state if needed
    if (network?.state.kv) {
      if (!network.state.kv.has("initialized")) {
        console.log("Initializing network state");
        network.state.kv.set("initialized", true);
        network.state.kv.set("history", []);
      }
    } else {
      console.log("Warning: No network state available");
    }
    
    if (!network?.state.kv?.get("answer")) {
      return APAIAgent;
    }
    return;
  }
});

// Create Inngest client
const inngest = new Inngest({
  id: "apai-agent-network"
});

// Create the function
const apaiAgentFunction = inngest.createFunction(
  {
    id: "apai-agent",
    name: "APAI Agent",
    retries: 0,
    concurrency: 1
  },
  {
    event: "apai/request"
  },
  async ({ event }) => {
    const executionId = (event as any)._inngest?.gid || uuidv4();
    console.log(`\n=== Function Execution ${executionId} ===`);
    console.log("Event data:", event.data);
    
    try {
      // Use network.run() to handle the entire conversation flow
      const finalResult = await apaiAgentNetwork.run(event.data.input);
      
      console.log(`\n=== Function Result ${executionId} ===`);
      console.log("Final Result:", finalResult);
      
      return finalResult;
    } catch (error: any) {
      console.error(`\n=== Function Error ${executionId} ===`);
      console.error("Error:", error);
      
      // Handle overloaded error
      if (error?.type === 'overloaded_error') {
        console.log("Server overloaded, returning error message...");
        return {
          output: [{
            type: 'text',
            role: 'assistant',
            content: 'The server is currently overloaded. Please try again in a few moments.'
          }]
        };
      }
      
      throw error;
    }
  }
);

// Create and start the server
const server = createServer({
  networks: [apaiAgentNetwork],
  appId: "apai-agent-network",
  functions: [apaiAgentFunction]
});

// Initialize Inngest state
server.on("start", () => {
  console.log("Initializing Inngest state...");
});

// Start the server
server.listen(3010, () => {
  console.log("APAI Agent demo server is running on port 3010");
  console.log("Connecting to MCP server at:", apaiUrl);
});

// Handle server errors
server.on("error", (error) => {
  console.error("Server error:", error);
});

// Handle process termination
process.on("SIGTERM", () => {
  console.log("Shutting down server...");
  server.close(() => {
    console.log("Server shut down complete");
    process.exit(0);
  });
});
