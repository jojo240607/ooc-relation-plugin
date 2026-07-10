import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

export class McpClient implements vscode.Disposable {
    private process: cp.ChildProcess | null = null;
    private requestId = 0;
    private pending = new Map<number, { resolve: (value: any) => void; reject: (reason?: any) => void }>();
    private binaryPath: string;
    private toolsCache: any[] | null = null;
    private cacheFilePath: string;           // 缓存文件路径
    private isFetchingTools: boolean = false; // 防止并发请求
    private isIndexing = false; // 简单并发锁
    private pendingToolRequests: Array<{ resolve: (value: any[]) => void; reject: (reason?: any) => void }> = [];

    constructor(private readonly _context: vscode.ExtensionContext, private workspaceRoot: string, storageDir?: string) {
        let extensionPath = _context.extensionPath;
        // 根据平台选择二进制
        if (process.platform === 'win32') {
            this.binaryPath = path.join(extensionPath, 'bin', 'codebase-memory-mcp.exe');
        } else if (process.platform === 'linux') {
            this.binaryPath = path.join(extensionPath, 'bin', 'codebase-memory-mcp');
        } else if (process.platform === 'darwin') {
            this.binaryPath = path.join(extensionPath, 'bin', 'codebase-memory-mcp');
        } else {
            throw new Error('Unsupported platform: ' + process.platform);
        }
        // 设置缓存文件路径path.join(this._workspaceRoot, '.vscode', 'ooc-chat-data.json');
        const cacheRoot = storageDir || path.join(workspaceRoot, '.vscode');
        if (!fs.existsSync(cacheRoot)) {
            fs.mkdirSync(cacheRoot, { recursive: true });
        }
        this.cacheFilePath = path.join(cacheRoot, 'tools-cache.json');
    }

    async start(): Promise<void> {
        if (this.process) {
            return;
        }
        // 1. 保证 auto_index 开启（全局）
        try {
            cp.execSync(`"${this.binaryPath}" config set auto_index true`, { stdio: 'ignore' });
        } catch {}
        // 2. 保证 auto_watch 开启（全局）
        try {
            cp.execSync(`"${this.binaryPath}" config set auto_watch true`, { stdio: 'ignore' });
        } catch {}

        // 3. 设定缓存目录
        const cacheDir = path.join(this.workspaceRoot, '.cbm-cache');
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        // 4. 环境变量 + 启动参数
        const env = {
            ...process.env,
            CBM_CACHE_DIR: cacheDir,
        };
        const args = ['--cache-dir', cacheDir];

        // 5. 启动子进程
        this.process = cp.spawn(this.binaryPath, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.workspaceRoot,
            env: env
        });

        this.process.on('error', (err) => {
            console.error('[MCP] spawn error:', err);
            this.process = null;
        });

        // 6. 监听 stdout（JSON‑RPC 响应）
        this.process.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(line => line.trim());
            for (const line of lines) {
                try {
                    const res = JSON.parse(line);
                    const pending = this.pending.get(res.id);
                    if (pending) {
                        if (res.error) {
                            pending.reject(new Error(res.error.message || JSON.stringify(res.error)));
                        } else {
                            pending.resolve(res.result);
                        }
                        this.pending.delete(res.id);
                    }
                } catch (e) {
                    // 非 JSON 输出，忽略
                }
            }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
            console.error('[MCP] stderr:', data.toString());
        });

        this.process.on('exit', (code) => {
            console.warn(`[MCP] exited with code ${code}`);
            this.process = null;
        });

        // 7. 等待进程启动
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 8. MCP 握手
        try {
            const initResult = await this.sendRequest('initialize', {
                protocolVersion: '0.1',
                capabilities: {},
                clientInfo: { name: 'ooc-plugin', version: '1.0.0' }
            });
            console.log('[MCP] Initialize OK:', JSON.stringify(initResult));
            this.sendNotification('notifications/initialized', {});
        } catch (e) {
            console.error('[MCP] Initialize failed:', e);
        }

        // 9. ★ 主动索引当前项目（使用新方法，支持更长时间超时）
        try {
            console.log('[MCP] Starting initial index for', this.workspaceRoot);
            const result = await this.syncIndex(this.workspaceRoot, 'full');
            if (result.success) {
                console.log('[MCP] Initial index succeeded:', result.message);
            } else {
                console.warn('[MCP] Initial index failed:', result.message);
            }
        } catch (e) {
            console.error('[MCP] Initial index error:', e);
        }

        console.log('[MCP] Process ready');
    }

    // ---------- 原有方法（完全保留） ----------

    private async sendRequest(method: string, params: any, timeoutMs: number = 3000): Promise<any> {
        if (!this.process || this.process.killed) {
            throw new Error('MCP server is not running');
        }
        const id = ++this.requestId;
        const request = { jsonrpc: '2.0', method, params, id };
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.process!.stdin?.write(JSON.stringify(request) + '\n');

            const timeout = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error('MCP request timeout params ' + JSON.stringify(params)));
                }
            }, timeoutMs);

            this.pending.set(id, {
                resolve: (value: any) => { clearTimeout(timeout); resolve(value); },
                reject: (reason?: any) => { clearTimeout(timeout); reject(reason); }
            });
        });
    }

    private async callToolUnwrapped(toolName: string, args: any): Promise<any> {
        const heavyTools = ['search_graph', 'query_graph', 'trace_path', 'index_repository'];
        const timeout = heavyTools.includes(toolName) ? 12000 : 3000;
        return this.sendRequest('tools/call', { name: toolName, arguments: args }, timeout);
    }

    async callTool(toolName: string, args: Record<string, any>): Promise<{ success: boolean; message: string }> {
        try {
            const result = await this.callToolUnwrapped(toolName, args);
            if (typeof result === 'string') return { success: true, message: result };
            if (result?.content && Array.isArray(result.content)) {
                const text = result.content.map((item: any) => item.text || '').join('\n');
                return { success: true, message: text };
            }
            return { success: true, message: JSON.stringify(result, null, 2) };
        } catch (err: any) {
            return { success: false, message: `MCP error: ${err.message}` };
        }
    }

    private sendNotification(method: string, params: any) {
        if (this.process && !this.process.killed) {
            const notif = { jsonrpc: '2.0', method, params };
            this.process.stdin?.write(JSON.stringify(notif) + '\n');
        }
    }

    async getTools(): Promise<any[]> {
        // 1. 内存缓存命中
        if (this.toolsCache) return this.toolsCache;

        // 2. 如果正在请求，等待当前请求完成
        if (this.isFetchingTools) {
            return new Promise((resolve, reject) => {
                this.pendingToolRequests.push({ resolve, reject });
            });
        }

        // 3. 开始请求
        this.isFetchingTools = true;
        try {
            let tools = await this.fetchToolsFromServer();
            if (tools.length > 0) {
                this.toolsCache = tools;
                // 异步写入文件（不阻塞返回）
                this.saveToolsToFile(tools).catch(e => console.warn('Save tools cache failed:', e));
                return tools;
            }

            // 4. 服务器返回空，尝试从文件加载
            const cached = await this.loadToolsFromFile();
            if (cached) {
                this.toolsCache = cached;
                return cached;
            }
            return [];
        } catch (e) {
            console.error('[MCP] getTools error:', e);
            // 请求异常，尝试从文件加载
            const cached = await this.loadToolsFromFile();
            if (cached) {
                console.debug('[MCP] getTools cached:', cached);
                this.toolsCache = cached;
                return cached;
            }
            console.error('[MCP] getTools cached:', cached);
            return [];
        } finally {
            this.isFetchingTools = false;
            // 处理所有等待的请求
            const pending = this.pendingToolRequests.slice();
            this.pendingToolRequests = [];
            for (const req of pending) {
                if (this.toolsCache) {
                    req.resolve(this.toolsCache);
                } else {
                    req.reject(new Error('Failed to fetch tools'));
                }
            }
        }
    }

    // 从服务器获取工具列表（原逻辑）
    private async fetchToolsFromServer(): Promise<any[]> {
        const result = await this.sendRequest('tools/list', {});
        console.log('[MCP] tools/list raw result:', JSON.stringify(result));

        if (result.isError) {
            console.error('[MCP] tools/list error:', result.content?.[0]?.text);
            return [];
        }

        let tools: any[] = [];
        if (Array.isArray(result)) {
            tools = result;
        } else if (result && Array.isArray(result.tools)) {
            tools = result.tools;
        } else if (result && Array.isArray(result.content)) {
            const textItem = result.content.find((item: any) => item.type === 'text');
            if (textItem) {
                const inner = JSON.parse(textItem.text);
                tools = inner.tools || inner;
            }
        }
        return tools;
    }
    private _loadDefaultTools(): string {
        const defaultToolPath = path.join(this._context.extensionPath, 'resources', 'default-tools-cache.json');
        if (!fs.existsSync(defaultToolPath)) {
            throw new Error(`默认工具列表：${defaultToolPath}`);
        }
        const defaultTools = fs.readFileSync(defaultToolPath, 'utf-8').trim();
        if (!defaultTools) throw new Error('默认工具列表文件为空');
        return defaultTools;
    }
    // 文件缓存读写
    private async loadToolsFromFile(): Promise<any[] | null> {
        let parsed = null;
        if (!fs.existsSync(this.cacheFilePath)) {
            const defaultTools = this._loadDefaultTools();
            parsed = JSON.parse(defaultTools);
            console.log('[MCP] Loaded tools from default:', parsed.length);
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.log('[MCP] save tools from default to  cache');
                this.saveToolsToFile(parsed).catch(e => console.warn('Save tools cache failed:', e));
            }
        } else {
            const cacheTools = fs.readFileSync(this.cacheFilePath, 'utf-8').trim();
            parsed = JSON.parse(cacheTools);
            console.log('[MCP] Loaded tools from cache:', parsed.length);
        }
        
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
        } else {
            console.error("load tools is null");
        }
        return null;
    }

    private async saveToolsToFile(tools: any[]): Promise<void> {
        try {
            await fs.promises.writeFile(this.cacheFilePath, JSON.stringify(tools, null, 2), 'utf-8');
        } catch (e) {
            console.warn('Failed to write tools cache:', e);
        }
    }

    // 清除缓存（用于调试或强制刷新）
    clearToolsCache() {
        this.toolsCache = null;
        // 可选：删除文件
        //try {
        //    fs.unlinkSync(this.cacheFilePath);
        //} catch {}
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }

    dispose() {
        this.stop();
    }

    // ---------- ★ 新增：外部调用的同步索引方法 ----------
    /**
     * 手动触发项目索引（同步等待完成）
     * @param projectPath 要索引的项目路径（默认使用当前 workspaceRoot）
     * @param mode 索引模式：'fast' 或 'full'（默认 'fast'）
     * @param timeoutMs 超时时间（毫秒），默认 60000（60秒）
     * @returns 成功/失败信息
     */
    async syncIndex(
        projectPath?: string,
        mode: 'fast' | 'full' = 'fast',
        timeoutMs: number = 60000
    ): Promise<{ success: boolean; message: string }> {
        
        const repoPath = projectPath || this.workspaceRoot;
        //console.log(`syncIndex from ${repoPath}`);
        if (!repoPath) {
            return { success: false, message: 'No project path specified' };
        }

        // 防止并发索引
        if (this.isIndexing) {
            return { success: false, message: 'Index already in progress' };
        }

        this.isIndexing = true;
        try {
            // 直接使用 sendRequest 以获得自定义超时
            const result = await this.sendRequest(
                'tools/call',
                {
                    name: 'index_repository',
                    arguments: {
                        repo_path: repoPath,
                        mode: mode,
                        persistence: false
                    }
                },
                timeoutMs
            );

            // 格式化返回结果
            if (typeof result === 'string') {
                return { success: true, message: result };
            }
            if (result?.content && Array.isArray(result.content)) {
                const text = result.content.map((item: any) => item.text || '').join('\n');
                return { success: true, message: text };
            }
            return { success: true, message: JSON.stringify(result, null, 2) };
        } catch (err: any) {
            return { success: false, message: `Index error: ${err.message}` };
        } finally {
            this.isIndexing = false;
        }
    }
}