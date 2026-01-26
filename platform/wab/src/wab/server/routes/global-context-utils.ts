import { UpdateGlobalContextReq } from "@/wab/shared/ApiSchema";
import { setTplComponentArg } from "@/wab/shared/TplMgr";
import { paramToVarName } from "@/wab/shared/codegen/util";
import { codeLit } from "@/wab/shared/core/exprs";
import { Site, TplComponent, VariantSetting } from "@/wab/shared/model/classes";

/**
 * Find a TplComponent in site.globalContexts by component name.
 */
function findGlobalContextTpl(
  site: Site,
  contextName: string
): TplComponent | undefined {
  return site.globalContexts.find((t) => t.component.name === contextName);
}

/**
 * Update a single prop on a TplComponent.
 * Returns a warning message if the prop is not found.
 */
function updateGlobalContextProp(
  tpl: TplComponent,
  vs: VariantSetting,
  propName: string,
  value: string | number | boolean | null,
  contextName: string
): string | undefined {
  const param = tpl.component.params.find(
    (p) => paramToVarName(tpl.component, p) === propName
  );

  if (!param) {
    return `Prop "${propName}" not found on global context "${contextName}"`;
  }

  setTplComponentArg(tpl, vs, param.variable, codeLit(value));
  return undefined;
}

/**
 * Apply all prop updates for a single global context.
 * Returns an array of warning messages.
 */
function applyGlobalContextUpdate(
  site: Site,
  update: UpdateGlobalContextReq
): string[] {
  const tpl = findGlobalContextTpl(site, update.name);

  if (!tpl) {
    return [`Global context "${update.name}" not found in project`];
  }

  const vs = tpl.vsettings[0];
  if (!vs) {
    return [`Global context "${update.name}" has no variant settings`];
  }

  return Object.entries(update.props)
    .map(([propName, value]) =>
      updateGlobalContextProp(tpl, vs, propName, value, update.name)
    )
    .filter((warning): warning is string => warning !== undefined);
}

/**
 * Process all global context updates.
 * Returns an array of warning messages.
 */
export function applyGlobalContextUpdates(
  site: Site,
  updates: UpdateGlobalContextReq[]
): string[] {
  return updates.flatMap((update) => applyGlobalContextUpdate(site, update));
}
