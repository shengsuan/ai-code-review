import { OpenAIChatProvider } from "./openai";

export class CompatibleProvider extends OpenAIChatProvider {
  override readonly name: string = "compatible";
  protected override readonly tokenField: string = "max_tokens";
}
