#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ModxProxyService } from "./modx-proxy.js";

const server = new Server(
  {
    name: "modx-proxy",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize MODX proxy service
const modxProxy = new ModxProxyService();

// Auto-login on startup if credentials are provided
async function initializeServer() {
  const username = process.env.MODX_USERNAME;
  const password = process.env.MODX_PASSWORD;
  const baseUrl = process.env.MODX_BASE_URL;

  if (username && password) {
    console.error('Attempting auto-login with provided credentials...');
    try {
      const result = await modxProxy.login(username, password, baseUrl);
      if (result.success) {
        console.error('Auto-login successful');
      } else {
        console.error('Auto-login failed:', result.message);
      }
    } catch (error) {
      console.error('Auto-login error:', error instanceof Error ? error.message : error);
    }
  } else {
    console.error('No MODX credentials provided - server will not be functional');
  }
}

// Interface for processor info
interface ProcessorInfo {
  path: string;
  namespace: string;
  description: string;
  class: string;
  file: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: any;
    value?: any;
  }>;
}

// Cache for processors
let processorsCache: ProcessorInfo[] | null = null;

/**
 * Convert processor namespace/action to tool name
 * Example: core/resource/getlist -> modx_core_resource_getlist
 */
function processorToToolName(namespace: string, action: string): string {
  const cleanNamespace = namespace.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const cleanAction = action.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `modx_${cleanNamespace}_${cleanAction}`;
}

/**
 * Convert tool name back to namespace/action
 * Example: modx_core_resource_getlist -> { namespace: 'core', action: 'resource/getlist' }
 */
function toolNameToProcessor(toolName: string): { namespace: string; action: string } | null {
  if (!toolName.startsWith('modx_')) {
    return null;
  }

  // Remove modx_ prefix
  const remaining = toolName.substring(5);

  // Find original processor by matching tool names
  if (processorsCache) {
    for (const processor of processorsCache) {
      if (processorToToolName(processor.namespace, processor.path) === toolName) {
        return {
          namespace: processor.namespace,
          action: processor.path
        };
      }
    }
  }

  return null;
}

/**
 * Convert MODX parameter type to JSON Schema type
 */
function modxTypeToJsonSchemaType(modxType: string): string {
  switch (modxType.toLowerCase()) {
    case 'integer':
    case 'int':
      return 'integer';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'string':
    case 'text':
      return 'string';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    case 'mixed':
    default:
      return 'string'; // Default to string for mixed/unknown types
  }
}

/**
 * Create dynamic tool from processor info
 */
function createProcessorTool(processor: ProcessorInfo): Tool {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  // Build properties from processor parameters
  if (processor.parameters && Array.isArray(processor.parameters)) {
    for (const param of processor.parameters) {
      // Skip permission checks and internal parameters
      if (!param.name || param.name === '_permission_check' || param.name.startsWith('_')) {
        continue;
      }

      properties[param.name] = {
        type: modxTypeToJsonSchemaType(param.type || 'string'),
        description: param.description || `Parameter: ${param.name}`,
      };

      // Add default value if available and not empty string
      if (param.default !== undefined && param.default !== null && param.default !== '') {
        properties[param.name].default = param.default;
      }

      // Add to required if parameter is required
      if (param.required === true) {
        required.push(param.name);
      }
    }
  }

  return {
    name: processorToToolName(processor.namespace, processor.path),
    description: `${processor.description} (${processor.namespace}/${processor.path})`,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: true, // Allow additional parameters not defined in schema
    },
  };
}

/**
 * Get all available tools (base tools + dynamic processor tools)
 */
async function getAllTools(): Promise<Tool[]> {
  const baseTools: Tool[] = [
    {
      name: "modx_get_session_info",
      description: "Get information about current MODX session",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];

  // Check authentication status
  const sessionInfo = modxProxy.getSessionInfo();
  if (!sessionInfo.isAuthenticated) {
    console.error('Not authenticated - returning only session info tool');
    return baseTools;
  }

  // Try to get processors and create dynamic tools
  try {
    if (!processorsCache) {
      console.error('Loading processors from MODX...');
      const processors = await modxProxy.getProcessors();
      processorsCache = processors.processors;
      console.error(`Loaded ${processorsCache.length} processors`);
    }

    const dynamicTools = processorsCache.map(processor => createProcessorTool(processor));
    console.error(`Created ${dynamicTools.length} dynamic tools`);

    return [...baseTools, ...dynamicTools];
  } catch (error) {
    console.error('Error loading processors:', error);
    // Return base tools if processors can't be loaded
    return baseTools;
  }
}

// List tools handler - return dynamic tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await getAllTools();
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle base tools
    if (name === "modx_get_session_info") {
      const sessionInfo = modxProxy.getSessionInfo();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(sessionInfo, null, 2),
          },
        ],
      };
    }

    // Handle dynamic processor tools
    if (name.startsWith("modx_")) {
      const processorInfo = toolNameToProcessor(name);

      if (processorInfo) {
        const data = args as Record<string, any>;
        const result = await modxProxy.callProcessor(processorInfo.namespace, processorInfo.action, data || {});

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }
    }

    // Unknown tool
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            tool: name,
            arguments: args,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  // Initialize and auto-login
  await initializeServer();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MODX Proxy MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
