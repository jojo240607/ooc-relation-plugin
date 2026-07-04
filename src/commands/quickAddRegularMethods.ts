import * as vscode from 'vscode';
import { syncService } from '../sync/ClassSyncService';
import { relationStore } from '../sync/ClassRelationStore';
import * as ast from '../utils/astUtils';

/**
 * 不依赖 UI 的快速添加常规方法命令
 * @param className 类名
 * @param headerUri 头文件 URI
 * @param methods 方法数组 { returnType, name, params }
 * @returns 执行结果
 */
export async function quickAddRegularMethods(
    className: string,
    headerUri: vscode.Uri,
    methods: { returnType: string; name: string; params: string }[]
): Promise<{ success: boolean; message: string }> {
    try {
        const sourceUri = vscode.Uri.joinPath(headerUri, '..', `${className}.c`);
        // 检查源文件是否存在
        try { await vscode.workspace.fs.stat(sourceUri); } catch {
            return { success: false, message: `Source file ${className}.c not found.` };
        }

        const headerDoc = await vscode.workspace.openTextDocument(headerUri);
        const classStruct = ast.findStruct(headerDoc, className);
        if (!classStruct) {
            return { success: false, message: `Struct ${className} not found in header.` };
        }

        // 获取父类和虚表状态（用于缓存更新）
        const parentName = ast.getParentClassName(classStruct, headerDoc);
        const hasVtable = ast.hasVtableStruct(headerDoc, className);

        // 逐个添加方法
        for (const m of methods) {
            const selfParam = `${className} *self`;
            const fullParams = m.params ? `${selfParam}, ${m.params}` : selfParam;

            // 1. 头文件：向 Fun 结构体插入函数指针声明
            const funMemberDecl = `${m.returnType} (*${m.name})(${fullParams});`;
            await ast.insertFunMember(headerDoc, className, funMemberDecl);

            // 2. 源文件：前向声明
            let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            const decl = `static ${m.returnType} ${className}_${m.name}(${fullParams});`;
            if (!sourceDoc.getText().includes(decl)) {
                await ast.insertAfterIncludes(sourceDoc, decl);
            }
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);

            // 3. 源文件：static 实现函数
            const defaultReturn = m.returnType === 'void' ? '' : `static ${m.returnType} ret = {0}; return ret;`;
            const impl = `\nstatic ${m.returnType} ${className}_${m.name}(${fullParams}) {\n    /* TODO: Implement */\n    ${defaultReturn}\n}\n`;
            await ast.insertAtEndOfFile(sourceDoc, impl);

            // 4. 源文件：在 _init 函数中为 fun 表赋值
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await ast.insertFunInit(sourceDoc, className, m.name, `${className}_${m.name}`);
        }

        // 保存修改后的文件
        const finalHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await finalHeaderDoc.save();
        const finalSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await finalSourceDoc.save();

        // 更新关系表（hasVtable 和 parent 不变，但保证路径等信息最新）
        const relativePath = vscode.workspace.asRelativePath(headerUri);
        await syncService.registerClass(className, relativePath, parentName, hasVtable);

        return { success: true, message: `${methods.length} regular method(s) added to ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error adding regular methods: ${err.message}` };
    }
}