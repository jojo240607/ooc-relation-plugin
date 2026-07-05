import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';

interface AncestorMethod {
    returnType: string;
    name: string;
    params: string;
    fromClass: string;
    vtablePath: string;
}

/**
 * 移除方法参数中的 self 指针，只保留额外参数
 */
function removeSelfParam(params: string, parentClassName: string): string {
    const selfPrefix = `${parentClassName} *self`;
    if (params.startsWith(selfPrefix)) {
        const rest = params.substring(selfPrefix.length).trim();
        return rest.startsWith(',') ? rest.substring(1).trim() : rest;
    }
    return params;
}

/**
 * 为一个方法生成 override 声明、赋值、实现，并写入源文件
 * @returns 成功/失败信息
 */
async function overrideSingleMethod(
    childName: string,
    headerUri: vscode.Uri,
    sourceUri: vscode.Uri,
    method: AncestorMethod
): Promise<{ success: boolean; message: string }> {
    const extraParams = removeSelfParam(method.params, method.fromClass);
    const fullParams = extraParams
        ? `${method.fromClass} *self, ${extraParams}`
        : `${method.fromClass} *self`;

    const overrideFuncName = `override_${childName}_${method.fromClass}_${method.name}_impl`;

    try {
        let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);

        // 1. 前向声明
        const decl = `static ${method.returnType} ${overrideFuncName}(${fullParams});`;
        if (!sourceDoc.getText().includes(decl)) {
            await ast.insertAfterIncludes(sourceDoc, decl);
        }

        // 2. 虚表赋值
        const assign = `self->${method.vtablePath}->${method.name} = ${overrideFuncName};`;
        sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await ast.insertBeforeFunctionEnd(sourceDoc, `${childName}_init`, assign);

        // 3. 实现
        const ret = method.returnType === 'void'
            ? ''
            : `static ${method.returnType} ret = {0}; return ret;`;
        const impl = `\nstatic ${method.returnType} ${overrideFuncName}(${fullParams}) {\n    ${childName} *child = (${childName}*)self;\n    /* TODO: Override implementation */\n    (void)child;\n    ${ret}\n}\n`;
        sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await ast.insertAtEndOfFile(sourceDoc, impl);

        return { success: true, message: `Overrode ${method.name} from ${method.fromClass}` };
    } catch (err: any) {
        return { success: false, message: `Error overriding ${method.name}: ${err.message}` };
    }
}

/**
 * 批量覆盖多个祖先方法
 * @returns 整体结果
 */
export async function overrideMethodsInSource(
    childName: string,
    headerUri: vscode.Uri,
    sourceUri: vscode.Uri,
    methods: AncestorMethod[]
): Promise<{ success: boolean; message: string }> {
    let successCount = 0;
    const errors: string[] = [];

    for (const m of methods) {
        const res = await overrideSingleMethod(childName, headerUri, sourceUri, m);
        if (res.success) {
            successCount++;
        } else {
            errors.push(res.message);
        }
    }

    // 保存文件
    try {
        const finalSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await finalSourceDoc.save();
        const finalHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await finalHeaderDoc.save();
    } catch (err: any) {
        return { success: false, message: `Error saving files: ${err.message}` };
    }

    if (errors.length > 0) {
        return { success: false, message: `${successCount} succeeded, errors: ${errors.join('; ')}` };
    }
    return { success: true, message: `Successfully overridden ${successCount} method(s) in ${childName}.` };
}