import * as vscode from 'vscode';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';

import { addVtableToClass } from './addVirtualMethod'; // 需要确保已导出
import { propagateVtableChange } from '../repair/propagateVtableChange';
import * as ast from '../utils/astUtils';

export async function quickAddVirtualMethods(
    className: string,
    headerUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[]
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
        try { await vscode.workspace.fs.stat(sourceUri); } catch { return { success: false, message: `Source file ${className}.c not found.` }; }

        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        const classStruct = ast.findStruct(headerDoc, className);
        if (!classStruct) return { success: false, message: `Struct ${className} not found in header.` };

        const parentName = ast.getParentClassName(classStruct, headerDoc);
        const needsVtable = !ast.hasVtableStruct(headerDoc, className);

        if (needsVtable) {
            const success = await addVtableToClass(headerUri, sourceUri, className);
            if (!success) return { success: false, message: `Failed to add virtual table to ${className}.` };

            // 更新缓存并将 hasVtable 设为 true
            const relativePath = vscode.workspace.asRelativePath(headerUri);
            await syncService.registerClass(className, relativePath, parentName, true);
            await propagateVtableChange(className);
        }

        // 实际插入虚函数声明和定义
        for (const m of methods) {
            const selfParam = `${className} *self`;
            const fullParams = m.params ? `${selfParam}, ${m.params}` : selfParam;
            const vtableName = `${className}Vtable`;
            const funcPtrDecl = `${m.returnType} (*${m.name})(${fullParams});`;

            // 头文件：插入到虚表结构体
            await ast.insertStructMember(headerDoc, vtableName, funcPtrDecl);

            // 源文件：生成默认实现等（复用 addVirtualMethod 中的逻辑）
            const defaultFuncName = `default_${className}_${m.name}_impl`;
            let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);

            // 前向声明
            const decl = `static ${m.returnType} ${defaultFuncName}(${fullParams});`;
            if (!sourceDoc.getText().includes(decl)) {
                await ast.insertAfterIncludes(sourceDoc, decl);
            }

            // 默认实现
            const defaultReturn = m.returnType === 'void' ? '' : `static ${m.returnType} ret = {0}; return ret;`;
            const defaultImpl = `\nstatic ${m.returnType} ${defaultFuncName}(${fullParams}) {\n    /* TODO: Implement */\n    (void)self;\n    ${defaultReturn}\n}\n`;
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await ast.insertAtEndOfFile(sourceDoc, defaultImpl);

            // 虚表赋值
            const vtableAssign = `self->vtable->${m.name} = ${defaultFuncName};`;
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await ast.insertBeforeFunctionEnd(sourceDoc, `${className}_init`, vtableAssign);
        }

        // 保存文件
        const finalHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await finalHeaderDoc.save();
        const finalSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await finalSourceDoc.save();

        // 更新缓存（可能已经是 true，但再次确认）
        if (!needsVtable) {
            const relativePath = vscode.workspace.asRelativePath(headerUri);
            await syncService.registerClass(className, relativePath, parentName, true);
        }

        return { success: true, message: `${methods.length} virtual method(s) added to ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error adding virtual methods: ${err.message}` };
    }
}