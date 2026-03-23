import { Project, SyntaxKind, FunctionDeclaration, MethodDeclaration, ArrowFunction, Node } from 'ts-morph';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AstEditor');

export class AstEditor {
  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Loads a file into the AST project or returns the existing one.
   */
  public getFile(filePath: string) {
    let sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      sourceFile = this.project.addSourceFileAtPath(filePath);
    }
    return sourceFile;
  }

  /**
   * Save the modified file to disk
   */
  public async saveFile(filePath: string) {
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) throw new Error(`File not loaded: ${filePath}`);
    await sourceFile.save();
    log.info(`[AstEditor] Saved changes to ${filePath}`);
  }

  /**
   * Replaces the entire function declaration/expression (including signature and body)
   * or just the body, based on the provided replacement string.
   */
  public replaceFunction(filePath: string, functionName: string, newFunctionCode: string): boolean {
    const sourceFile = this.getFile(filePath);
    
    // First try finding a top-level function declaration
    const funcDecl = sourceFile.getFunction(functionName);
    if (funcDecl) {
      funcDecl.replaceWithText(newFunctionCode);
      return true;
    }

    // Try finding a variable declaration with an arrow function or function expression
    const varDecl = sourceFile.getVariableDeclaration(functionName);
    if (varDecl) {
      const initializer = varDecl.getInitializer();
      if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
        initializer.replaceWithText(newFunctionCode);
        return true;
      }
    }

    // Try finding a method in any class
    const classes = sourceFile.getClasses();
    for (const cls of classes) {
      const method = cls.getMethod(functionName);
      if (method) {
        method.replaceWithText(newFunctionCode);
        return true;
      }
    }

    throw new Error(`Function or method named '${functionName}' not found in ${filePath}`);
  }

  /**
   * Adds an import statement to the file.
   */
  public addImport(filePath: string, moduleSpecifier: string, namedImports?: string[], defaultImport?: string): boolean {
    const sourceFile = this.getFile(filePath);
    
    // Check if import for this module already exists
    const existingImport = sourceFile.getImportDeclaration(moduleSpecifier);
    
    if (existingImport) {
      // Merge named imports if provided
      if (namedImports && namedImports.length > 0) {
        const existingNamedImports = existingImport.getNamedImports().map(ni => ni.getName());
        for (const named of namedImports) {
          if (!existingNamedImports.includes(named)) {
            existingImport.addNamedImport(named);
          }
        }
      }
      // Set default import if not already set (rare to re-set, but we'll assign if none)
      if (defaultImport && !existingImport.getDefaultImport()) {
        existingImport.setDefaultImport(defaultImport);
      }
      return true;
    }

    // Create new import declaration
    sourceFile.addImportDeclaration({
      moduleSpecifier,
      namedImports: namedImports,
      defaultImport: defaultImport
    });
    
    return true;
  }

  /**
   * Safely renames a symbol (variable, function, class, etc.) across the file.
   */
  public renameSymbol(filePath: string, oldName: string, newName: string): boolean {
    const sourceFile = this.getFile(filePath);
    
    // Find the symbol declaration
    // This is a simplified rename: we look for the first declaration matching the oldName
    const varDecl = sourceFile.getVariableDeclaration(oldName);
    if (varDecl) {
      varDecl.rename(newName);
      return true;
    }

    const funcDecl = sourceFile.getFunction(oldName);
    if (funcDecl) {
      funcDecl.rename(newName);
      return true;
    }

    const classDecl = sourceFile.getClass(oldName);
    if (classDecl) {
      classDecl.rename(newName);
      return true;
    }

    const interfaceDecl = sourceFile.getInterface(oldName);
    if (interfaceDecl) {
      interfaceDecl.rename(newName);
      return true;
    }

    const typeDecl = sourceFile.getTypeAlias(oldName);
    if (typeDecl) {
      typeDecl.rename(newName);
      return true;
    }

    throw new Error(`Symbol '${oldName}' not found for renaming in ${filePath}`);
  }
}

// Singleton instance inside this module
export const astEditor = new AstEditor();
