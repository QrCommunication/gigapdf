import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react';
import { GigaPdfEditor } from './index';
import type { GigaPdfOptions, GigaPdfEvents } from './types';

export type { GigaPdfEvents };

/** Props for the React component — container is managed internally */
export interface GigaPdfEditorProps extends Omit<GigaPdfOptions, 'container' | 'onComplete'> {
  /** Called when the editor is ready */
  onReady?: GigaPdfEvents['ready'];
  /** Called when the document is saved */
  onSave?: GigaPdfEvents['save'];
  /** Called when a PDF export is triggered */
  onExport?: GigaPdfEvents['export'];
  /** Called on error */
  onError?: GigaPdfEvents['error'];
  /** Called when the current page changes */
  onPageChange?: GigaPdfEvents['pageChange'];
  /** Called when the user clicks "Done" — receives the modified PDF as a Blob */
  onComplete?: GigaPdfEvents['complete'];
  /** Additional style for the wrapper div */
  style?: CSSProperties;
  /** Additional className for the wrapper div */
  className?: string;
}

/** Methods exposed via ref */
export interface GigaPdfEditorRef {
  exportPdf(format?: string): void;
  savePdf(): void;
  loadDocument(documentId: string): void;
  getFile(): Promise<Blob>;
}

export const GigaPdfEditorComponent = forwardRef<GigaPdfEditorRef, GigaPdfEditorProps>(
  function GigaPdfEditorComponent(props, ref) {
    const {
      onReady,
      onSave,
      onExport,
      onError,
      onPageChange,
      onComplete,
      style,
      className,
      // All remaining props are GigaPdfOptions (minus container)
      apiKey,
      publicKey,
      documentId,
      file,
      baseUrl,
      width,
      height,
      locale,
      theme,
      hideToolbar,
      tools,
      showDoneButton,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<GigaPdfEditor | null>(null);

    // Expose imperative methods via ref
    useImperativeHandle(ref, () => ({
      exportPdf(format?: string) {
        editorRef.current?.exportPdf(format);
      },
      savePdf() {
        editorRef.current?.savePdf();
      },
      loadDocument(documentId: string) {
        editorRef.current?.loadDocument(documentId);
      },
      getFile() {
        if (!editorRef.current) return Promise.reject(new Error('[GigaPdf] Editor not ready'));
        return editorRef.current.getFile();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const handleComplete = onComplete
        ? (blob: Blob) => onComplete({ blob })
        : undefined;

      const options: GigaPdfOptions = {
        apiKey,
        publicKey,
        container: containerRef.current,
        documentId,
        file,
        baseUrl,
        width,
        height,
        locale,
        theme,
        hideToolbar,
        tools,
        showDoneButton,
        onComplete: handleComplete,
      };

      const editor = new GigaPdfEditor(options);
      editorRef.current = editor;

      if (onReady) editor.on('ready', onReady);
      if (onSave) editor.on('save', onSave);
      if (onExport) editor.on('export', onExport);
      if (onError) editor.on('error', onError);
      if (onPageChange) editor.on('pageChange', onPageChange);

      return () => {
        editor.destroy();
        editorRef.current = null;
      };
      // Re-create the editor only when identity-stable options change.
      // Callbacks are intentionally excluded to avoid needless re-mounts;
      // callers should memoize them if they care about identity.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiKey, publicKey, documentId, file, baseUrl, width, height, locale, theme, hideToolbar, tools, showDoneButton]);

    // Sync event handlers without re-creating the editor
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (onReady) editor.on('ready', onReady);
      return () => {
        if (onReady) editor.off('ready', onReady);
      };
    }, [onReady]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (onSave) editor.on('save', onSave);
      return () => {
        if (onSave) editor.off('save', onSave);
      };
    }, [onSave]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (onExport) editor.on('export', onExport);
      return () => {
        if (onExport) editor.off('export', onExport);
      };
    }, [onExport]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (onError) editor.on('error', onError);
      return () => {
        if (onError) editor.off('error', onError);
      };
    }, [onError]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      if (onPageChange) editor.on('pageChange', onPageChange);
      return () => {
        if (onPageChange) editor.off('pageChange', onPageChange);
      };
    }, [onPageChange]);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !onComplete) return;
      const handler = (data: { blob: Blob }) => onComplete(data);
      editor.on('complete', handler);
      return () => { editor.off('complete', handler); };
    }, [onComplete]);

    return <div ref={containerRef} style={style} className={className} />;
  },
);

GigaPdfEditorComponent.displayName = 'GigaPdfEditor';

export { GigaPdfEditorComponent as GigaPdfEditor };
