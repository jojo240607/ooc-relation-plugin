# OOC Relation Plugin

![](resources/ooc-icon.svg)



面向对象 C（OOC）编程的 Visual Studio Code 扩展，提供类继承管理、虚函数、成员添加、PlantUML 类图生成等功能，基于轻量级关系表，无需全局扫描项目文件。

## 主要功能

- **创建类 / 接口 / 子类**  
  通过右键菜单快速创建 OOC 风格的 `.h` / `.c` 文件，自动生成模板代码（含 `init` / `deinit` 函数、union 继承等）。

- **添加虚函数**  
  在已有类中自动生成虚表结构体，支持从祖先继承虚函数，并通过可视化面板添加新的虚方法。

- **添加常规方法（Fun 表）**  
  为类添加普通函数，插入 Fun 结构体声明与源文件实现。

- **重写虚函数**  
  列出所有祖先的虚方法，可一键勾选并生成覆盖实现。

- **添加成员变量**  
  可视化面板为结构体添加成员变量。

- **类关系缓存与视图**  
  插件维护一张轻量级关系表（`.vscode/class-relations.json`），仅记录被操作过的类，避免全局扫描。  
  侧边栏继承树视图实时展示所有已记录类及其父/子关系，悬停显示文件路径、虚表信息，并支持接口图标。

- **PlantUML 类图**  
  一键生成所有已记录类的 UML 图（支持缩放、拖拽），自动判断接口，并可保存为 `.puml` 文件。

- **文件同步**  
  当文件被移动、重命名或删除时，关系表自动更新，保持视图与代码一致。

- **智能接口检测**  
  生成类图时自动分析源文件，若类没有提供虚函数的默认实现且未被标记为 `/* OOC_INTERFACE */`，则视为接口，并更新缓存标记。

## 使用方式

### 命令
| 命令 | 说明 |
|------|------|
| `OOC: Create Class` | 创建基类（右键文件夹） |
| `OOC: Create Interface` | 创建接口（右键文件夹） |
| `OOC: Create Subclass` | 创建子类（右键 .h 文件） |
| `OOC: Add Virtual Method` | 添加虚函数（右键 .h 文件） |
| `OOC: Add Regular Method` | 添加常规方法（右键 .h 文件） |
| `OOC: Override Methods` | 重写祖先虚函数（右键 .h 文件） |
| `OOC: Add Members` | 添加成员变量（右键 .h 文件） |
| `OOC: Show Class Diagram` | 生成 PlantUML 类图（可通过树视图节点调用） |

### 创建一个对象
空白处右键点击，选择OOC：Create Class  

![](resources/screencat/create_list.png)

![](resources/screencat/create_class.png)

![](resources/screencat/new_class.png)



### 创建一个子对象

选择某个对象的h文件，右键点击，选择OOC：Create Subclass  

![](resources/screencat/create_sub_list.png)

![](resources/screencat/create_sub_class.png)

![](resources/screencat/newsub_class.png)



### 添加一个虚函数

选择某个对象的h文件，右键点击，选择OOC：Add Virtural Method

 对话框中会列出父类的所有虚函数![](resources/screencat/add_virtual_method.png)



### 重写虚函数

选择某个对象的h文件，右键点击，选择OOC：Override Virtural Method

 对话框中会列出父类的所有可以重写的虚函数

![](resources/screencat/override_virtual_method.png)



### 侧边栏类关系树状图

打开 “OOC Inheritance” 视图，展开即可看到树形继承结构。

点击节点打开对应头文件。  

![](resources/screencat/class_tree_view.png)



### 类关系生成PUNML类图

打开 “OOC Inheritance” 视图，展开即可看到树形继承结构。  

- 点击OOC：Show Class Diagram

  ![](resources/screencat/class_view_pmul.png)

### PlantUML 类图
类图提供拖拽和 Ctrl+滚轮缩放，并包含保存按钮，可将当前 PlantUML 源码导出为 `.puml` 文件。

## 安装

1. 在 VS Code 中按 `Ctrl+Shift+X` 打开扩展市场，搜索 “OOC Relation Plugin” 并安装。  
2. 或从 VSIX 手动安装：下载 `ooc-relation-plugin-x.x.x.vsix`，运行 `code --install-extension ooc-relation-plugin-x.x.x.vsix`。  
3. 也可克隆仓库到 `.vscode/extensions` 目录。

## 依赖

- 需要 `plantuml-encoder` 用于生成类图图片（自动包含于安装包）。
- 其他依赖已在 `package.json` 中声明。

## 配置

插件自动在工作区根目录下的 `.vscode/class-relations.json` 存储关系缓存，可加入 `.gitignore`，因为它是本地重建的缓存文件。  
无额外用户设置。

## 反馈与贡献

欢迎提交 Issue 或 PR 到 [GitHub 仓库地址]。

---

**让 C 语言也享受面向对象的便利！**