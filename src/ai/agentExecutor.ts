import * as vscode from 'vscode';
import { relationStore } from '../sync/ClassRelationStore';
import { FunctionCall } from './deepseekClient';
import * as quickCommands from '../commands/quickCommands';

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
                    // 自动计算 vtablePath，忽略 AI 传入的值
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
                case 'write_source_code': {
                    const outputPath = call.arguments.outputPath as string | undefined;
                    const headerPath = call.arguments.headerPath as string | undefined;
                    const code = typeof call.arguments.code === 'string' ? call.arguments.code : '';
                    const modeStr = (call.arguments.mode as string) || 'append';
                    const mode: 'replace' | 'append' = (modeStr === 'replace') ? 'replace' : 'append';
                    if (outputPath) {
                        // 直接使用 outputPath 调用（不走命令，直接调用 writeCode 或独立实现）
                        
                        result = await quickCommands.quickWriteCodeToPath(outputPath, code, mode);
                    } else if (headerPath) {
                        const headerUri = vscode.Uri.file(headerPath);
                        result = await vscode.commands.executeCommand('ooc.quickWriteCode',
                            headerUri, code, mode);
                    } else {
                        result =  { success: false, message: '❌ write_source_code 必须提供 headerPath 或 outputPath' };
                    }
                    break;
                }
                case 'modify_function_body': {
                    const headerPath = call.arguments.headerPath;
                    const functionName = call.arguments.functionName;
                    const codeContent = call.arguments.codeContent;
                    const mode = call.arguments.mode || 'append';
                    const headerUri = vscode.Uri.file(headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickModifyFunction',
                        headerUri, functionName, codeContent, mode);
                    break;
                }
                case 'add_private_function': {
                    const headerUri = vscode.Uri.file(call.arguments.headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickAddPrivateFunction',
                        headerUri, call.arguments.returnType, call.arguments.funcName,
                        call.arguments.params, call.arguments.body);
                    break;
                }
                case 'add_global_variable': {
                    const headerUri = vscode.Uri.file(call.arguments.headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickAddGlobalVariable',
                        headerUri, call.arguments.type, call.arguments.name, call.arguments.initialValue);
                    break;
                }
                case 'add_include': {
                    const headerUri = vscode.Uri.file(call.arguments.headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickAddInclude',
                        headerUri, call.arguments.includePath);
                    break;
                }
                case 'read_source_file': {
                    const headerUri = vscode.Uri.file(call.arguments.headerPath);
                    result = await vscode.commands.executeCommand('ooc.quickReadSource', headerUri);
                    break;
                }
                case 'set_code_section': {
                    const { headerPath, sectionName, newCode, sectionType = 'auto' } = call.arguments;
                    result = await quickCommands.quickSetCodeSection(headerPath, sectionName, newCode, sectionType);
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