import * as vscode from 'vscode';
import { syncService } from './sync/ClassSyncService';  // 导入单例
import { InheritanceTreeDataProvider } from './inheritanceTreeProvider';
import { createClass } from './commands/createClass';
import { createInterface } from './commands/createInterface';
import { createSubclass } from './commands/createSubclass';
import { addVirtualMethod } from './commands/addVirtualMethod';
import { addRegularMethod } from './commands/addRegularMethod';
import { overrideMethods } from './commands/overrideMethods';
import { addMembers } from './commands/addMembers';
import { showClassDiagram } from './commands/showClassDiagram';
import { InheritanceNode } from './inheritanceTreeProvider';
import * as quickCommands from './commands/quickCommands';
import { ChatViewProvider } from './ai/chatViewProvider';
import { McpClient } from './mcp/mcpClient';
import { showMCPPanel } from './commands/showMCPPanel';

let mcpClient: McpClient;   // 导出供命令使用
export function activate(context: vscode.ExtensionContext) {
    console.log('OOC Relation Plugin is now active!');

    // 初始化同步服务（加载关系表并启动监听）
    syncService.initialize().then(() => {
        console.log('Relation store loaded and sync started.');
    });

    // 树视图
    const treeProvider = new InheritanceTreeDataProvider(context.extensionUri);
    const treeView = vscode.window.createTreeView('ooc-inheritance-view', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);
    // 注册侧边栏聊天视图
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    mcpClient = new McpClient(context, workspaceRoot);
    const chatProvider = new ChatViewProvider(context, mcpClient);
    let debounceTimer: NodeJS.Timeout | null = null;
    // 当关系表变化时，自动刷新树视图
    syncService.onRelationsChanged(() => {
        console.log('[SyncService] onRelationsChanged triggered');
        treeProvider.refresh();
    });

    syncService.onAnyFileChange((event) => {
        // 只处理工作区内的文件（可选）
        if (!event.uri.fsPath.startsWith(workspaceRoot)) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            mcpClient.syncIndex(workspaceRoot, 'fast')
                .then(result => {
                    if (result.success) {
                        console.log('[MCP] Index auto-updated');
                    } else {
                        console.warn('[MCP] Index update failed:', result.message);
                    }
                })
                .catch(err => console.error('[MCP] Index error:', err));
            debounceTimer = null;
        }, 300); // 300ms 防抖延迟
    });

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('ooc-ai-chat-view', chatProvider)
    );
    // 注册命令（不再需要手动 treeProvider.refresh()，事件会自动刷新）
    context.subscriptions.push(
        vscode.commands.registerCommand('ooc.createClass', async (uri?: vscode.Uri) => {
            await createClass(context, uri);
        }),
        vscode.commands.registerCommand('ooc.createInterface', async (uri?: vscode.Uri) => {
            await createInterface(context, uri);
        }),
        vscode.commands.registerCommand('ooc.createSubclass', async (uri?: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('Please right-click on a .h file.');
                return;
            }
            await createSubclass(context, uri);
        }),
        vscode.commands.registerCommand('ooc.addVirtualMethod', async (uri?: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('Please right-click on a .h file.');
                return;
            }
            await addVirtualMethod(context, uri);
        }),
        vscode.commands.registerCommand('ooc.overrideMethods', async (uri?: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('Please right-click on a .h file to override methods.');
                return;
            }
            await overrideMethods(context, uri);
        }),
        vscode.commands.registerCommand('ooc.addRegularMethod', async (uri?: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('Please right-click on a .h file to add regular methods.');
                return;
            }
            await addRegularMethod(context, uri);
        }),
        vscode.commands.registerCommand('ooc.addMembers', async (uri?: vscode.Uri) => {
            if (!uri) {
                vscode.window.showErrorMessage('Please right-click on a .h file.');
                return;
            }
            await addMembers(context, uri);
        }),
        vscode.commands.registerCommand('ooc.showClassDiagram', (item?: InheritanceNode) => {
            const highlightClassName = item?.name;
            showClassDiagram(context, treeProvider, highlightClassName);
        }),
        vscode.commands.registerCommand('ooc.quickCreateClass', async (className: string, folderUri: vscode.Uri) => {
            return await quickCommands.quickCreateClass(className, folderUri);
        }),
        vscode.commands.registerCommand('ooc.quickCreateInterface', async (interfaceName: string, folderUri: vscode.Uri, methods?: any[]) => {
            return await quickCommands.quickCreateInterface(interfaceName, folderUri, methods || []);
        }),
        vscode.commands.registerCommand('ooc.quickCreateSubclass', async (parentName: string, parentUri: vscode.Uri, subclassName: string, targetFolderUri?: vscode.Uri) => {
            return await quickCommands.quickCreateSubclass(parentName, parentUri, subclassName, targetFolderUri);
        }),
        vscode.commands.registerCommand('ooc.quickAddVirtualMethods', async (className: string, headerUri: vscode.Uri, methods: any[]) => {
            return await quickCommands.quickAddVirtualMethods(className, headerUri, methods);
        }),
        vscode.commands.registerCommand('ooc.quickOverrideMethod', async (className: string, headerUri: vscode.Uri, fromClass: string, method: any, vtablePath: string) => {
            return await quickCommands.quickOverrideMethod(className, headerUri, fromClass, method, vtablePath);
        }),
        vscode.commands.registerCommand('ooc.quickAddMembers', async (className: string, headerUri: vscode.Uri, members: any[]) => {
            return await quickCommands.quickAddMembers(className, headerUri, members);
        }),
        vscode.commands.registerCommand('ooc.quickAddRegularMethods', async (className: string, headerUri: vscode.Uri, methods: any[]) => {
            return await quickCommands.quickAddRegularMethods(className, headerUri, methods);
        }),
        vscode.commands.registerCommand('ooc.quickWriteCode', async (headerUri: vscode.Uri, codeContent: string, mode: 'replace' | 'append') => {
            // 修正后的参数签名，直接从 agentExecutor 传递
            return await quickCommands.quickWriteCode(headerUri, codeContent, mode || 'append');
        }),
        vscode.commands.registerCommand('ooc.quickModifyFunction', async (headerUri: vscode.Uri, functionName: string, codeContent: string, mode: string) => {
            return await quickCommands.quickModifyFunction(headerUri, functionName, codeContent, mode as 'replace' | 'append');
        }),
        vscode.commands.registerCommand('ooc.quickAddPrivateFunction', async (headerUri: vscode.Uri, returnType: string, funcName: string, params: string, body: string) => {
            return await quickCommands.quickAddPrivateFunction(headerUri, returnType, funcName, params, body);
        }),
        vscode.commands.registerCommand('ooc.quickAddGlobalVariable', async (headerUri: vscode.Uri, type: string, name: string, initialValue?: string) => {
            return await quickCommands.quickAddGlobalVariable(headerUri, type, name, initialValue);
        }),
        vscode.commands.registerCommand('ooc.quickAddInclude', async (headerUri: vscode.Uri, includePath: string) => {
            return await quickCommands.quickAddInclude(headerUri, includePath);
        }),
        vscode.commands.registerCommand('ooc.quickReadSource', async (headerUri: vscode.Uri) => {
            return await quickCommands.quickReadSource(headerUri);
        }),
        vscode.commands.registerCommand('ooc.openAiChat', () => {
            vscode.commands.executeCommand('workbench.action.focusPanel');
        }),
        vscode.commands.registerCommand('extension.showMCPTestPanel', () => {
            showMCPPanel(context, mcpClient)
        })
        );

    // 清理
    context.subscriptions.push({
        dispose: () => syncService.dispose()
    });
    console.log('Before activateChatParticipant');
    // 启动 AI Chat Participant
    //activateChatParticipant(context);
        // 激活 AI Webview 聊天面板
  //  activateWebviewChat(context);
    console.log('After activateChatParticipant');
}

export function deactivate() {}