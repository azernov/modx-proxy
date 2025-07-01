import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

// Types
interface LoginResult {
  success: boolean;
  message: string;
  user?: any;
  sessionInfo?: any;
}

interface ProcessorResult {
  success: boolean;
  message?: string;
  data?: any;
  errors?: any;
  object?: any;
  results?: any;
}

interface ProcessorList {
  processors: Array<{
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
  }>;
  total: number;
  generated_at: string;
}

interface SessionInfo {
  isAuthenticated: boolean;
  baseUrl?: string;
  connectorUrl?: string;
  user?: any;
  loginTime?: Date;
  lastActivity?: Date;
}

export class ModxProxyService {
  private httpClient: AxiosInstance;
  private cookieJar: CookieJar;
  private baseUrl: string = '';
  private connectorPath: string = '';
  private adminPath: string = '';
  private modxMcpConnectorPath: string = '';
  private isAuthenticated: boolean = false;
  private sessionInfo: SessionInfo = { isAuthenticated: false };
  private processorCache: ProcessorList | null = null;
  private authToken: string = '';

  constructor() {
    this.cookieJar = new CookieJar();
    this.httpClient = wrapper(axios.create({
      jar: this.cookieJar,
      withCredentials: true,
      timeout: 30000,
      headers: {
        'User-Agent': 'MODX-Proxy-MCP/2.0',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
    }));

    // Set URLs from environment variables
    this.baseUrl = process.env.MODX_BASE_URL || 'http://localhost';
    this.connectorPath = process.env.MODX_CONNECTOR_PATH || '/connectors/';
    this.adminPath = process.env.MODX_ADMIN_PATH || '/manager/';
    
    // For modx-mcp specific processors, we'll use our custom connector
    this.modxMcpConnectorPath = '/assets/components/modx-mcp/connector.php';
    
    // Ensure paths start and end with slashes
    this.connectorPath = this.normalizePath(this.connectorPath);
    this.adminPath = this.normalizePath(this.adminPath);
  }

  /**
   * Normalize path to ensure it starts and ends with slash
   */
  private normalizePath(path: string): string {
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    if (!path.endsWith('/')) {
      path = path + '/';
    }
    return path;
  }

  /**
   * Authenticate with MODX using standard connector
   */
  async login(username: string, password: string, baseUrl?: string): Promise<LoginResult> {
    try {
      // Update URLs if provided
      if (baseUrl) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
      }

      const connectorUrl = `${this.baseUrl}${this.connectorPath}`;
      const refererUrl = `${this.baseUrl}${this.adminPath}`;

      // Skip initial GET request since this MODX requires immediate authentication

      // Prepare login data for standard MODX connector
      const loginData = new URLSearchParams({
        action: 'security/login',
        username: username,
        password: password,
        rememberme: '0',
        format: 'json'
      });

      // Perform login using standard connector
      const response: AxiosResponse = await this.httpClient.post(connectorUrl, loginData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': refererUrl,
        },
      });

      // Parse response
      let result;
      if (typeof response.data === 'string') {
        try {
          result = JSON.parse(response.data);
        } catch (e) {
          throw new Error('Invalid JSON response from MODX');
        }
      } else {
        result = response.data;
      }

      if (result.success) {
        this.isAuthenticated = true;
        this.authToken = result.object?.token || '';
        this.sessionInfo = {
          isAuthenticated: true,
          baseUrl: this.baseUrl,
          connectorUrl: connectorUrl,
          user: result.object || result.data,
          loginTime: new Date(),
          lastActivity: new Date(),
        };

        return {
          success: true,
          message: 'Successfully authenticated with MODX',
          user: result.object || result.data,
          sessionInfo: this.sessionInfo,
        };
      } else {
        this.isAuthenticated = false;
        return {
          success: false,
          message: result.message || 'Authentication failed',
        };
      }

    } catch (error) {
      this.isAuthenticated = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown authentication error';
      
      return {
        success: false,
        message: `Authentication error: ${errorMessage}`,
      };
    }
  }

  /**
   * Get list of all MODX processors via modx-mcp component
   */
  async getProcessors(refresh: boolean = false): Promise<ProcessorList> {
    if (this.processorCache && !refresh) {
      return this.processorCache;
    }

    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      this.sessionInfo.lastActivity = new Date();

      const connectorUrl = `${this.baseUrl}${this.modxMcpConnectorPath}`;
      const refererUrl = `${this.baseUrl}${this.adminPath}`;

      // Call modx-mcp component processor to get processors list
      const processorData = new URLSearchParams({
        action: 'data/index',
        namespace: 'modx-mcp',
        format: 'json',
        'HTTP_MODAUTH': this.authToken
      });

      const response: AxiosResponse = await this.httpClient.post(connectorUrl, processorData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': refererUrl,
        },
      });

      // Parse response
      let result;
      if (typeof response.data === 'string') {
        try {
          result = JSON.parse(response.data);
        } catch (e) {
          throw new Error('Invalid JSON response from MODX component');
        }
      } else {
        result = response.data;
      }

      if (result.success && result.object) {
        const processorList: ProcessorList = {
          processors: result.object.processors || [],
          total: result.object.total || 0,
          generated_at: result.object.generated_at || 'unknown'
        };

        this.processorCache = processorList;
        return processorList;
      } else {
        throw new Error(result.message || 'Failed to get processors from MODX component');
      }

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          this.isAuthenticated = false;
          this.sessionInfo.isAuthenticated = false;
          throw new Error('Session expired. Please login again.');
        }
        
        throw new Error(`HTTP error ${error.response?.status}: ${error.message}`);
      }
      
      throw new Error(`Failed to get processors: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Call a specific MODX processor using standard connector
   */
  async callProcessor(namespace: string, action: string, data: Record<string, any> = {}): Promise<ProcessorResult> {
    if (!this.isAuthenticated) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      this.sessionInfo.lastActivity = new Date();

      const connectorUrl = `${this.baseUrl}${this.connectorPath}`;
      const refererUrl = `${this.baseUrl}${this.adminPath}`;

      // Prepare processor data
      const processorData = new URLSearchParams({
        action: action,
        format: 'json',
        'HTTP_MODAUTH': this.authToken,
        ...data
      });

      // Call processor
      const response: AxiosResponse = await this.httpClient.post(connectorUrl, processorData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': refererUrl,
        },
      });

      // Parse response
      let result;
      if (typeof response.data === 'string') {
        try {
          result = JSON.parse(response.data);
        } catch (e) {
          // If not JSON, return as text
          result = {
            success: true,
            data: response.data,
            raw: true,
          };
        }
      } else {
        result = response.data;
      }

      return {
        success: result.success !== false,
        message: result.message,
        data: result.data || result.object || result.results,
        errors: result.errors,
        object: result.object,
        results: result.results,
        ...result
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          this.isAuthenticated = false;
          this.sessionInfo.isAuthenticated = false;
          throw new Error('Session expired. Please login again.');
        }
        
        throw new Error(`HTTP error ${error.response?.status}: ${error.message}`);
      }
      
      throw new Error(`Processor call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Logout from MODX
   */
  async logout(): Promise<{ success: boolean; message: string }> {
    try {
      if (this.isAuthenticated) {
        // Call logout processor
        await this.callProcessor('core', 'security/logout');
      }

      // Clear session
      this.isAuthenticated = false;
      this.authToken = '';
      this.sessionInfo = { isAuthenticated: false };
      
      // Clear cookies
      await this.cookieJar.removeAllCookies();

      return {
        success: true,
        message: 'Successfully logged out from MODX',
      };

    } catch (error) {
      // Even if logout fails, clear local session
      this.isAuthenticated = false;
      this.authToken = '';
      this.sessionInfo = { isAuthenticated: false };
      
      return {
        success: true,
        message: 'Logged out (session cleared locally)',
      };
    }
  }

  /**
   * Get current session information
   */
  getSessionInfo(): SessionInfo {
    return { ...this.sessionInfo };
  }
}