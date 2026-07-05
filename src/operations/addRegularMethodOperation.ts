import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';

interface RegularMethodEntry {
    returnType: string;
    name: string;
    params: string;
}

/**
 * 向类中添加多个常规方法（Fun 表方法）
 * @returns 操作结果
 */
export async function addRegularMethodsToClass(
    className: string,
    headerUri: vscode.Uri,
    sourceUri: vscode.Uri,
    methods: RegularMethodEntry[]
): Promise<{ success: boolean; message: string }> {
    try {
        for (const m of methods) {
            const selfParam = `${className} *self`;
            const fullParams = m.params ? `${selfParam}, ${m.params}` : selfParam;

            // 1. 头文件：向 Fun 结构体插入函数指针声明
            const headerDoc = await vscode.workspace.openTextDocument(headerUri);
            const funMemberDecl = `${m.returnType} (*${m.name})(${fullParams});`;
            await ast.insertFunMember(headerDoc, className, funMemberDecl);

            // 2. 源文件：前向声明
            let sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            const decl = `static ${m.returnType} ${className}_${m.name}(${fullParams});`;
            if (!sourceDoc.getText().includes(decl)) {
                await ast.insertAfterIncludes(sourceDoc, decl);
            }
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);

            // 3. 源文件：static 实现
            const defaultReturn = m.returnType === 'void' ? '' : `static ${m.returnType} ret = {0}; return ret;`;
            const impl = `\nstatic ${m.returnType} ${className}_${m.name}(${fullParams}) {\n    /* TODO: Implement */\n    ${defaultReturn}\n}\n`;
            await ast.insertAtEndOfFile(sourceDoc, impl);

            // 4. 源文件：fun 表初始化赋值
            sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await ast.insertFunInit(sourceDoc, className, m.name, `${className}_${m.name}`);
        }

        // 保存文件
        const finalHeaderDoc = await vscode.workspace.openTextDocument(headerUri);
        await finalHeaderDoc.save();
        const finalSourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        await finalSourceDoc.save();

        return { success: true, message: `Successfully added ${methods.length} regular method(s) to ${className}.` };
    } catch (err: any) {
        return { success: false, message: `Error adding regular methods: ${err.message}` };
    }
}