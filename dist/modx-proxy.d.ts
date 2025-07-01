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
export declare class ModxProxyService {
    private httpClient;
    private cookieJar;
    private baseUrl;
    private connectorPath;
    private adminPath;
    private modxMcpConnectorPath;
    private isAuthenticated;
    private sessionInfo;
    private processorCache;
    private authToken;
    constructor();
    /**
     * Normalize path to ensure it starts and ends with slash
     */
    private normalizePath;
    /**
     * Authenticate with MODX using standard connector
     */
    login(username: string, password: string, baseUrl?: string): Promise<LoginResult>;
    /**
     * Get list of all MODX processors via modx-mcp component
     */
    getProcessors(refresh?: boolean): Promise<ProcessorList>;
    /**
     * Call a specific MODX processor using standard connector
     */
    callProcessor(namespace: string, action: string, data?: Record<string, any>): Promise<ProcessorResult>;
    /**
     * Logout from MODX
     */
    logout(): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Get current session information
     */
    getSessionInfo(): SessionInfo;
}
export {};
//# sourceMappingURL=modx-proxy.d.ts.map