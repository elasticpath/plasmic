/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react";

import { cloneWithInjectedHandlers } from "../cloneWithInjectedHandlers";

describe("cloneWithInjectedHandlers", () => {
  it("injects onClick onto a valid single child element with no existing onClick", () => {
    const onClick = jest.fn();
    const cloned = cloneWithInjectedHandlers(
      <button>label</button>,
      { injected: { onClick }, compose: ["onClick"] }
    );
    const { getByText } = render(<>{cloned}</>);
    fireEvent.click(getByText("label"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("composes existing onClick before injected onClick", () => {
    const calls: string[] = [];
    const designer = () => calls.push("designer");
    const injected = () => calls.push("injected");
    const cloned = cloneWithInjectedHandlers(
      <button onClick={designer}>x</button>,
      { injected: { onClick: injected }, compose: ["onClick"] }
    );
    const { getByText } = render(<>{cloned}</>);
    fireEvent.click(getByText("x"));
    expect(calls).toEqual(["designer", "injected"]);
  });

  it("returns the child unchanged for non-element values (string, fragment, array)", () => {
    const onClick = jest.fn();
    const opts = { injected: { onClick }, compose: ["onClick"] };
    expect(cloneWithInjectedHandlers("plain text", opts)).toBe("plain text");
    expect(cloneWithInjectedHandlers(null, opts)).toBeNull();
    const arr = [<span key="a">a</span>, <span key="b">b</span>];
    // arrays are not valid single elements — should be returned untouched
    expect(cloneWithInjectedHandlers(arr, opts)).toBe(arr);
  });

  it("supports multiple compose keys (runs each designer handler before injected)", () => {
    const calls: string[] = [];
    const dClick = () => calls.push("d-click");
    const dMouse = () => calls.push("d-mouse");
    const iClick = () => calls.push("i-click");
    const iMouse = () => calls.push("i-mouse");
    const cloned = cloneWithInjectedHandlers(
      <button onClick={dClick} onMouseEnter={dMouse}>z</button>,
      {
        injected: { onClick: iClick, onMouseEnter: iMouse },
        compose: ["onClick", "onMouseEnter"],
      }
    );
    const { getByText } = render(<>{cloned}</>);
    fireEvent.mouseEnter(getByText("z"));
    fireEvent.click(getByText("z"));
    expect(calls).toEqual(["d-mouse", "i-mouse", "d-click", "i-click"]);
  });

  it("override-only keys replace the existing value (no composition)", () => {
    const cloned = cloneWithInjectedHandlers(
      <button disabled={false}>q</button>,
      { injected: { disabled: true } }
    );
    const { getByText } = render(<>{cloned}</>);
    expect((getByText("q") as HTMLButtonElement).disabled).toBe(true);
  });
});
