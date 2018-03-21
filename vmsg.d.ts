declare module "vmsg" {
  interface RecordOptions {
    wasmURL?: string;
    shimURL?: string;
    pitch?: number;
  }
  interface Exports {
    record: (opts?: RecordOptions) => Promise<Blob>;
  }
  const exports: Exports;
  export default exports;
}
