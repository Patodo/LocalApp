import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { AuthProvider, useAuthModals } from "./auth-provider";

function LoginProbe() {
  const { loginReturnTo, openLogin } = useAuthModals();
  return (
    <>
      <button onClick={() => openLogin()}>登录</button>
      <output data-testid="return-to">{loginReturnTo ?? "null"}</output>
    </>
  );
}

describe("AuthProvider login return target", () => {
  it("defaults to the current application URL", () => {
    window.history.replaceState({}, "", "/test-owner/outer-ai-usage/?tab=billing#usage");

    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByTestId("return-to")).toHaveTextContent(
      "/test-owner/outer-ai-usage/?tab=billing#usage",
    );
  });
});
