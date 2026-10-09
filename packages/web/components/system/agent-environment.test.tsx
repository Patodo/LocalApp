import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SystemAgentEnvironment } from "./agent-environment";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows missing dependencies and allows a fresh check",async()=>{
 const fetchMock=vi.fn<any>().mockResolvedValue({ok:true,json:async()=>({data:{checkedAt:new Date().toISOString(),platform:"darwin",ready:false,checks:[{id:"pdfplumber",name:"pdfplumber",status:"missing",detail:"需要安装依赖",required:true}]}})});
 vi.stubGlobal("fetch",fetchMock);render(<SystemAgentEnvironment/>);
 expect(await screen.findByText("尚未就绪")).toBeInTheDocument();expect(screen.getByText("pdfplumber")).toBeInTheDocument();
 expect(fetchMock).toHaveBeenCalledWith("/api/system/agent-environment",{credentials:"include"});
 fireEvent.click(screen.getByRole("button",{name:"重新检查"}));await waitFor(()=>expect(fetchMock.mock.calls.filter(call => call[0] === "/api/system/agent-environment")).toHaveLength(2));
});
it("shows a configuration or authorization error without claiming readiness",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,json:async()=>({error:"需要管理员权限"})}));render(<SystemAgentEnvironment/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("需要管理员权限");expect(screen.queryByText("已就绪")).not.toBeInTheDocument();
});
