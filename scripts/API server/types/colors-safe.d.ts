declare module 'colors/safe' {
  const colors: {
    green(s: string): string
    red(s: string): string
    yellow(s: string): string
    blue(s: string): string
    [key: string]: (s: string) => string
  }
  export default colors
}
