// quickCommands.ts —— 汇总所有无UI快速命令

export { quickCreateClass } from './quickCreateClass';
export { quickCreateInterface } from './quickCreateInterface';
export { quickCreateSubclass } from './quickCreateSubclass';
export { quickAddVirtualMethods } from './quickAddVirtualMethods';
export { quickOverrideMethod } from './quickOverrideMethod';
export { quickAddMembers } from './quickAddMembers';
export { quickAddRegularMethods } from './quickAddRegularMethods';
export { quickWriteCode } from './quickWriteCode';

// 也可以在此统一定义类型，如命令返回结果等
export interface QuickCommandResult {
    success: boolean;
    message: string;
}