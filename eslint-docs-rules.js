/**
 * ESLint rules for enforcing kan-do documentation standards
 */
module.exports = {
  // Rule to enforce component documentation standards
  'vue/component-documentation': {
    create(context) {
      return {
        Program(node) {
          const sourceCode = context.getSourceCode();
          const sourceText = sourceCode.getText();
          const filename = context.getFilename();
          
          // Only apply to Vue component files
          if (!filename.endsWith('.vue')) {
            return;
          }
          
          // Check for component documentation block
          const hasComponentDocBlock = /<!--\s*@component\s+[\w\d]+\s*@description\s+[\s\S]*?@usage\s+[\s\S]*?@responsibility[\s\S]*?-->/.test(sourceText);
          
          if (!hasComponentDocBlock) {
            context.report({
              node,
              message: 'Component is missing documentation block. Add a comment block with @component, @description, @usage, and @responsibility tags.',
              loc: { line: 1, column: 0 }
            });
          }
          
          // Check for props documentation (relaxed)
          // Accept either:
          // 1. A JSDoc block comment preceding defineProps (e.g., "/** Props */")
          // 2. Inline JSDoc comments for each prop
          // 3. A @prop tag in the preceding block
          // Handle both defineProps<...>() and withDefaults(defineProps<...>(), ...)
          const patterns = [
            /defineProps<\{([\s\S]*?)\}>\(\)/g,
            /withDefaults\s*\(\s*defineProps<\{([\s\S]*?)\}>\(\)[\s\S]*?\)/g,
          ];
          for (const re of patterns) {
            let match;
            while ((match = re.exec(sourceText)) !== null) {
              const startIdx = match.index;
              const precedingWindow = sourceText.substring(Math.max(0, startIdx - 500), startIdx);
              
              // Accept if there's any JSDoc block comment or @prop tag before defineProps
              const hasDocBlock = /\/\*\*[\s\S]*?\*\//.test(precedingWindow) || /@prop/.test(precedingWindow);
              if (hasDocBlock) continue;

              const propsContent = match[1] || '';
              const propLines = propsContent.split('\n');
              for (let i = 0; i < propLines.length; i++) {
                const raw = propLines[i];
                const line = raw.trim();
                if (!line || line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')) continue;
                if (line.startsWith('}')) continue;
                if (line.includes('/**')) continue;
                const propName = line.split(':')[0]?.replace('readonly', '').replace('?', '').trim();
                if (propName) {
                  context.report({
                    node,
                    message: `Prop '${propName}' is missing documentation. Add a JSDoc comment (/** Description */).`,
                  });
                }
              }
            }
          }
          
          // Check for function documentation (relaxed): only enforce for exported functions
          const exportedFnRegex = /export\s+(?:async\s+)?function\s+([\w\d]+)\s*\(|export\s+const\s+([\w\d]+)\s*=\s*\([^)]*\)\s*=>/g;
          let fnMatch;
          while ((fnMatch = exportedFnRegex.exec(sourceText)) !== null) {
            const functionPos = fnMatch.index;
            const precedingText = sourceText.substring(Math.max(0, functionPos - 200), functionPos).trim();
            if (!/\*\*/.test(precedingText)) {
              const functionName = fnMatch[1] || fnMatch[2] || 'exported function';
              context.report({
                node,
                message: `Function '${functionName}' is missing documentation. Add a JSDoc comment.`,
              });
            }
          }
        }
      };
    }
  }
};
