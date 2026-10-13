type XlsxLibrary = typeof import('xlsx');

let xlsxPromise: Promise<XlsxLibrary> | undefined;

export function loadXlsx(): Promise<XlsxLibrary> {
  xlsxPromise ??= import('xlsx');
  return xlsxPromise;
}
