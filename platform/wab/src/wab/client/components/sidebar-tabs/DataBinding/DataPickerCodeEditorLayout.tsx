import {
  CodePreview,
  renderInspector,
} from "@/wab/client/components/coding/CodePreview";
import { DataInspector } from "@/wab/client/components/coding/DataInspector";
import type { FullCodeEditor } from "@/wab/client/components/coding/FullCodeEditor";
import LazyFullCodeEditor from "@/wab/client/components/coding/LazyFullCodeEditor";
import {
  DataPickerRunCodeActionContext,
  DataPickerTypesSchema,
} from "@/wab/client/components/sidebar-tabs/DataBinding/DataPicker";
import {
  DefaultDataPickerCodeEditorLayoutProps,
  PlasmicDataPickerCodeEditorLayout,
} from "@/wab/client/plasmic/plasmic_kit_data_binding/PlasmicDataPickerCodeEditorLayout";
import { useStudioCtx } from "@/wab/client/studio-ctx/StudioCtx";
import { isLiteralObjectByName } from "@/wab/shared/common";
import { HTMLElementRefOf } from "@plasmicapp/react-web";
import L from "lodash";
import * as React from "react";

export interface DataPickerCodeEditorLayoutProps
  extends Omit<DefaultDataPickerCodeEditorLayoutProps, "envPanel"> {
  editorRef: React.RefObject<FullCodeEditor>;
  data: object;
  defaultValue: string;
  onSave: (val: string) => boolean;
  schema?: DataPickerTypesSchema;
  context?: string;
  hideEnvPanel?: boolean;
}

function DataPickerCodeEditorLayout_(
  props: DataPickerCodeEditorLayoutProps,
  ref: HTMLElementRefOf<"div">
) {
  const {
    editorRef,
    data,
    defaultValue,
    onSave,
    schema,
    hideEnvPanel,
    context,
    ...rest
  } = props;
  const [currentValue, setCurrentValue] = React.useState(defaultValue);
  const [codeEditorKey, setCodeEditorKey] = React.useState(0);
  const [showEnv, setShowEnv] = React.useState(false);
  const studioCtx = useStudioCtx();
  const runCodeContext = React.useContext(DataPickerRunCodeActionContext);

  const completionData = React.useMemo(() => cleanDataForPreview(data), [data]);

  return (
    <PlasmicDataPickerCodeEditorLayout
      root={{ ref }}
      {...rest}
      codeEditor={
<<<<<<< HEAD
        <React.Suspense fallback={<div />}>
          <LazyFullCodeEditor
            ref={editorRef}
            key={codeEditorKey}
            hideLineNumbers={true}
            language={"javascript"}
            defaultValue={defaultValue}
            data={data}
            completionData={completionData}
            onSave={onSave}
            onChange={(val: string) => setCurrentValue(val)}
            enableMinimap={false}
            hideGlobalSuggestions={true}
            folding={false}
            schema={schema}
            autoFocus
          />
        </React.Suspense>
=======
        <LazyFullCodeEditor
          ref={editorRef}
          key={codeEditorKey}
          hideLineNumbers={true}
          language={"javascript"}
          defaultValue={defaultValue}
          data={completionData}
          onSave={onSave}
          onChange={(val: string) => setCurrentValue(val)}
          enableMinimap={false}
          hideGlobalSuggestions={true}
          folding={false}
          schema={schema}
          autoFocus
        />
>>>>>>> upstream/master
      }
      copilotCodePrompt={{
        props: {
          data,
          currentValue,
          onUpdate: (v) => {
            setCurrentValue(v);
            onSave(v);
            setCodeEditorKey(codeEditorKey + 1);
          },
          context,
        },
      }}
      codePreview={
        !runCodeContext ? (
          <CodePreview
            viewCtx={studioCtx.focusedViewCtx()}
            value={`(${currentValue})`}
            data={data}
          />
        ) : (
          renderInspector(runCodeContext.stepValue)
        )
      }
      envPanel={
        hideEnvPanel || !studioCtx.appCtx.appConfig.envPanel
          ? "hidden"
          : !showEnv
          ? "collapsed"
          : undefined
      }
<<<<<<< HEAD
      env={<EnvPreview previewData={completionData} />}
=======
      env={<DataInspector data={completionData} editorRef={editorRef} />}
>>>>>>> upstream/master
      envToggleButton={{
        onClick: () => setShowEnv(!showEnv),
      }}
    />
  );
}

<<<<<<< HEAD
function EnvPreview(props: {
  previewData: Record<string, any>;
  className?: string;
}) {
  const { previewData, className } = props;
  return (
    <div className={className}>
      <ErrorBoundary fallback={renderInspector(undefined)}>
        {renderInspector(previewData)}
      </ErrorBoundary>
    </div>
  );
}

function cleanDataForPreview(data: Record<string, any>): Record<string, any> {
  const cache = new Map<any, any>();

=======
export function cleanDataForPreview(
  data: Record<string, any>
): Record<string, any> {
  const cache = new Map<any, any>();

>>>>>>> upstream/master
  const rec = (x: any): any => {
    if (!!x && isLiteralObjectByName(x)) {
      const cleanedX = cache.get(x);
      if (cleanedX) {
        return cleanedX;
      }

<<<<<<< HEAD
      const filtered = L.omitBy(x, (_val, key) => {
=======
      const filtered = L.omitBy(x, (val, key) => {
>>>>>>> upstream/master
        return (
          key.startsWith("__plasmic") ||
          key.startsWith("$dataTokens_") ||
          key === "dataTokensEnv" ||
          key === "registerInitFunc" ||
<<<<<<< HEAD
          key === "eagerInitializeStates"
=======
          key === "eagerInitializeStates" ||
          (key === "$queries" && L.isEmpty(val)) // $queries is deprecated, we only show it if there are any queries
>>>>>>> upstream/master
        );
      });
      cache.set(x, filtered);
      Object.keys(filtered).forEach(
        (key) => (filtered[key] = rec(filtered[key]))
      );
      return filtered;
    }
    return x;
  };

  return rec(data);
}
export const _testonly = { cleanDataForPreview };

const DataPickerCodeEditorLayout = React.forwardRef(
  DataPickerCodeEditorLayout_
);
export default DataPickerCodeEditorLayout;
