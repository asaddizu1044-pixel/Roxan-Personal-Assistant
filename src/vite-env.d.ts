cat > src/vite-env.d.ts << 'EOF'
/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}
EOF