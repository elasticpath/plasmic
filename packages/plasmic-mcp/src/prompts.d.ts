declare module "prompts" {
  interface PromptObject {
    type: string;
    name: string;
    message: string;
  }

  function prompts(questions: PromptObject | PromptObject[]): Promise<Record<string, any>>;
  export default prompts;
}
