import * as vscode from 'vscode';
import { relationStore } from '../sync/ClassRelationStore';
import { FunctionCall } from './deepseekClient';

function isAlreadyExists(msg: string): boolean {
    return msg.includes('already exists');
}

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
                    if (result && !result.success && isAlreadyExists(result.message)) {
                        result = { success: true, message: 'Class already exists, skipped' };
                    }
                    break;
                }
                case 'create_interface': {
                    const folderUri = vscode.Uri.file(call.arguments.folderUri);
                    result = await vscode.commands.executeCommand('ooc.quickCreateInterface',
                        call.arguments.interfaceName, folderUri, call.arguments.methods || []);
                    if (result && !result.success && isAlreadyExists(result.message)) {
                        result = { success: true, message: 'Interface already exists, skipped' };
                    }
                    break;
                }
                case 'create_subclass': {
                    const parentHeaderPath = call.arguments.parentHeaderPath;
                    const parentUri = vscode.Uri.file(parentHeaderPath);
                    result = await vscode.commands.executeCommand('ooc.quickCreateSubclass',
                        call.arguments.parentName, parentUri, call.arguments.subclassName);
                    if (result && !result.success && isAlreadyExists(result.message)) {
                        result = { success: true, message: 'Subclass already exists, skipped' };
                    }
                    break;
                }
                case 'add_virtual_methods': {
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
                    // 始终自动计算 vtablePath，忽略 AI 传入的值
                    const depth = computeDepth(call.arguments.className, call.arguments.fromClass);
                    const vtablePath = depth > 0 ? Array(depth).fill('parent').join('.') + '.vtable' : 'vtable';
                    result = await vscode.commands.executeCommand('ooc.quickOverrideMethod',
                        call.arguments.className, headerUri, call.arguments.fromClass,
                        call.arguments.method, vtablePath);
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

function resolveHeaderPath(className: string): string {
    const entry = relationStore.getClass(className);
    if (entry && vscode.workspace.workspaceFolders?.[0]) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, entry.file).fsPath;
    }
    if (vscode.workspace.workspaceFolders?.[0]) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `${className}.h`).fsPath;
    }
    return `${className}.h`;
}

/**
 * 计算从 childName 到 ancestorName 需要经过多少个 parent 层级
 */
function computeDepth(childName: string, ancestorName: string): number {
    let depth = 0;
    let current = childName;
    const visited = new Set<string>();
    while (current !== ancestorName) {
        if (visited.has(current)) return -1;
        visited.add(current);
        const entry = relationStore.getClass(current);
        if (!entry || !entry.parent) return -1;
        current = entry.parent;
        depth++;
        if (depth > 20) return -1;
    }
    return depth;
}