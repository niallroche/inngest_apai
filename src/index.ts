/* eslint-disable */
import "dotenv/config";
import {
  anthropic,
  createAgent,
  createNetwork,
  createTool,
} from "@inngest/agent-kit";
import { createServer } from "@inngest/agent-kit/server";
import { z } from "zod";
import { v4 as uuidv4 } from 'uuid';
import { Inngest } from "inngest";

const apaiUrl = "http://localhost:9000/sse"

const doneTool = createTool({
  name: "done",
  description: "Call this tool when you are finished with the task.",
  parameters: z.object({
    answer: z.string().describe("Answer to the user's question.")
  }),
  handler: async ({ answer }, { network }) => {
    if (network?.state.kv) {
      network.state.kv.set("answer", answer);
    }
    return answer;
  }
});

const APAIAgent = createAgent({
  name: `apai-agent-${uuidv4()}`,
  system: `You are a helpful assistant that help manage smart legal contracts using the APAI API. You can create templates and agreements based off templates and trigger the agreement clauses via functions exposed by the APAI API.

Available tools:
- apai-convert-agreement-to-format: Converts an agreement to either HTML or Markdown format. The format parameter must be either "html" or "markdown".
- done: Call this when you have completed the task or if you encounter an error.

IMPORTANT: 
1. After using apai-convert-agreement-to-format, ALWAYS call the 'done' tool with the result or an error message.
2. If the tool call fails, call 'done' with an error message explaining what went wrong.
3. When using apai-convert-agreement-to-format, always use either "html" or "markdown" as the format parameter.
4. NEVER make the same tool call multiple times in a row.
5. If you get a response from apai-convert-agreement-to-format, immediately call 'done' with that response.
6. If you get an error from apai-convert-agreement-to-format, immediately call 'done' with an error message.
7. Do not make any other tool calls after apai-convert-agreement-to-format except for 'done'.
`,
  assistant: "",
  tools: [doneTool],
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
      console.log("Checking if agent is enabled");
      return true;
    },
    onStart: async ({ prompt, network }) => {
      console.log("Agent starting with prompt:", prompt);
      console.log("Network state:", network?.state);
      console.log("Available MCP tools:", Array.from(APAIAgent.tools.entries())
        .filter(([name]) => name.startsWith("apai-"))
        .map(([name, tool]) => ({
          name,
          description: tool.description || "No description available",
          parameters: tool.parameters ? "Parameters defined" : "No parameters",
          mcp: tool.mcp ? {
            server: tool.mcp.server.name,
            tool: {
              name: tool.mcp.tool.name,
              description: tool.mcp.tool.description,
              inputSchema: tool.mcp.tool.inputSchema
            }
          } : "No MCP details"
        })));
      return { prompt, history: [], stop: false };
    },
    onResponse: async ({ result }) => {
      console.log("Agent response:", result);
      
      // Check for tool calls
      const toolCall = result.output.find(output => output.type === 'tool_call')?.tools[0];
      if (toolCall) {
        if (toolCall.name === 'apai-convert-agreement-to-format') {
          // Validate format
          if (toolCall.input.format !== 'html' && toolCall.input.format !== 'markdown') {
            console.log("Warning: Invalid format specified for apai-convert-agreement-to-format");
            // Instead of modifying the result, we'll let the agent handle the error
            return result;
          }
        }
      }
      
      // Check if we've already made a tool call in the history
      const history = result.history || [];
      const previousToolCalls = history.filter(h => {
        const output = (h as any).output || [];
        return output.some((o: any) => 
          o.type === 'tool_call' && 
          o.tools.some((t: any) => t.name === 'apai-convert-agreement-to-format')
        );
      });
      
      if (previousToolCalls.length > 0) {
        console.log("Warning: Multiple tool calls detected, forcing 'done' call");
        // Force the agent to call 'done' by modifying the result
        result.output = [
          {
            type: 'tool_call',
            role: 'assistant',
            stop_reason: 'tool',
            tools: [{
              type: 'tool',
              id: `toolu_${Date.now()}`,
              name: 'done',
              input: {
                answer: "I've already attempted to convert the agreement. Please check the previous response."
              }
            }]
          }
        ];
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
    console.log("Network state:", network?.state);
    console.log("Agent tools:", Array.from(APAIAgent.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description || "No description available",
      parameters: tool.parameters ? "Parameters defined" : "No parameters"
    })));
    
    // Initialize network state if needed
    if (network?.state.kv) {
      if (!network.state.kv.has("initialized")) {
        network.state.kv.set("initialized", true);
        network.state.kv.set("history", []); // Initialize empty history
        network.state.kv.set("messages", []); // Initialize empty messages array
        network.state.kv.set("tools", []); // Initialize empty tools array
      }
    }
    
    // Return the agent if there's no answer yet
    if (!network?.state.kv.get("answer")) {
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
    name: "APAI Agent"
  },
  {
    event: "apai/request"
  },
  async ({ event }) => {
    return APAIAgent.run(event.data.input, {
      model: anthropic({
        model: "claude-3-5-sonnet-20240620",
        defaultParameters: {
          max_tokens: 1000,
        },
      })
    });
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
  console.log("Agent configuration:", {
    name: APAIAgent.name,
    tools: Array.from(APAIAgent.tools.entries()).map(([name, tool]) => ({
      name,
      description: tool.description || "No description available",
      parameters: tool.parameters ? "Parameters defined" : "No parameters"
    })),
    system: APAIAgent.system
  });
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
