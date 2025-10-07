declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

declare module '*?raw' {
  const content: string;
  export default content;
}
