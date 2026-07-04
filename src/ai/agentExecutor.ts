import * as vscode from 'vscode';
import { relationStore } from '../sync/ClassRelationStore'; // 根据实际路径调整
import { FunctionCall } from './deepseekClient';

/**
 * 执行一系列 Function Call，每个调用独立执行，不因单个失败而中断
 * @param calls AI 返回的工具调用列表
 * @returns 每个调用的执行结果字符串数组
 */
export async function executeFunctionCalls(calls: FunctionCall[]): Promise<string[]> {
    const results: string[] = [];

    for (const call of calls) {
        const prefix = `${call.name}: `;
        try {
            let result: { success: boolean; message: string } | undefined;

            switch (call.name) {
                case 'create_base_class': {
                    const folderUri = vscode.Uri.file(call.arguments.folderUri);
                    result = await vscode.commands.executeCommand('ooc.quickCreateClass',
                        call.arguments.className, folderUri);
                    break;
                }

                case 'create_interface': {
                    const folderUri = vscode.Uri.file(call.arguments.folderUri);
                    result = await vscode.commands.executeCommand('ooc.quickCreateInterface',
                        call.arguments.interfaceName, folderUri, call.arguments.methods || []);
                    break;
                }

                case 'create_subclass': {
                    const parentHeaderPath = call.arguments.parentHeaderPath;
                    const parentUri = vscode.Uri.file(parentHeaderPath);
                    result = await vscode.commands.executeCommand('ooc.quickCreateSubclass',
                        call.arguments.parentName, parentUri, call.arguments.subclassName);
                    break;
                }

                case 'add_virtual_methods': {
                    // 自动补全 headerPath
                    let headerPath = call.arguments.headerPath;
                    if (!headerPath) {
                        headerPath = resolveHeaderPath(call.arguments.className);
                    }
                    const headerUri = vscode.Uri.file(headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickAddVirtualMethods',
                        call.arguments.className, headerUri, call.arguments.methods);
                    break;
                }

                case 'override_method': {
                    let headerPath = call.arguments.headerPath;
                    if (!headerPath) {
                        headerPath = resolveHeaderPath(call.arguments.className);
                    }
                    const headerUri = vscode.Uri.file(headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickOverrideMethod',
                        call.arguments.className, headerUri, call.arguments.fromClass,
                        call.arguments.method, call.arguments.vtablePath);
                    break;
                }

                case 'add_members': {
                    let headerPath = call.arguments.headerPath;
                    if (!headerPath) {
                        headerPath = resolveHeaderPath(call.arguments.className);
                    }
                    const headerUri = vscode.Uri.file(headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickAddMembers',
                        call.arguments.className, headerUri, call.arguments.members);
                    break;
                }

                case 'add_regular_methods': {
                    let headerPath = call.arguments.headerPath;
                    if (!headerPath) {
                        headerPath = resolveHeaderPath(call.arguments.className);
                    }
                    const headerUri = vscode.Uri.file(headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickAddRegularMethods',
                        call.arguments.className, headerUri, call.arguments.methods);
                    break;
                }

                default:
                    result = { success: false, message: `Unknown tool: ${call.name}` };
            }

            if (result) {
                const icon = result.success ? '✅' : '❌';
                results.push(`${icon} ${prefix}${result.message}`);
            } else {
                results.push(`❌ ${prefix}No response from command`);
            }
        } catch (err: any) {
            results.push(`❌ ${prefix}Error: ${err.message}`);
        }
    }

    return results;
}

/**
 * 根据类名解析头文件的绝对路径
 * 优先从关系缓存中查找，其次假设在工作区根目录
 */
function resolveHeaderPath(className: string): string {
    const entry = relationStore.getClass(className);
    if (entry && vscode.workspace.workspaceFolders?.[0]) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, entry.file).fsPath;
    }
    if (vscode.workspace.workspaceFolders?.[0]) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `${className}.h`).fsPath;
    }
    return `${className}.h`; // fallback
}