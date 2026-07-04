import * as vscode from 'vscode';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';
import * as ast from '../utils/astUtils';

export async function quickOverrideMethod(
    className: string,
    headerUri: vscode.Uri,
    fromClass: string,
    method: { returnType: string; name: string; params: string },
    vtablePath: string // 例如 "parent.vtable"
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
        try { await vscode.workspace.fs.stat(sourceUri); } catch { return { success: false, message: `Source file ${className}.c not found.` }; }

        const overrideFuncName = `override_${className}_${fromClass}_${method.name}_impl`;
        const selfParam = `${fromClass} *self`;
        const fullParams = method.params ? `${selfParam}, ${method.params}` : selfParam;

        // 1. 前向声明
        let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        const decl = `static ${method.returnType} ${overrideFuncName}(${fullParams});`;
        if (!sourceDoc.getText().includes(decl)) {
            await ast.insertAfterIncludes(sourceDoc, decl);
        }

        // 2. 虚表赋值
        const assign = `self->${vtablePath}->${method.name} = ${overrideFuncName};`;
        sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await ast.insertBeforeFunctionEnd(sourceDoc, `${className}_init`, assign);

        // 3. 实现
        const ret = method.returnType === 'void' ? '' : `static ${method.returnType} ret = {0}; return ret;`;
        const impl = `\nstatic ${method.returnType} ${overrideFuncName}(${fullParams}) {\n    ${className} *child = (${className}*)self;\n    /* TODO: Override implementation */\n    (void)child;\n    ${ret}\n}\n`;
        sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await ast.insertAtEndOfFile(sourceDoc, impl);

        await sourceDoc.save();

        return { success: true, message: `Method ${method.name} from ${fromClass} overridden in ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error overriding method: ${err.message}` };
    }
}