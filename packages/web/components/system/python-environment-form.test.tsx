import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PythonEnvironmentForm } from "./python-environment-form";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("saves an existing virtual environment and refreshes the shared check",async()=>{
 const onUpdated=vi.fn(async()=>{});
 const request=vi.fn(async(_url,options)=>({ok:true,json:async()=>({data:{environment:options?.method ? {executable:"/env/bin/python",version:"3.12",directory:"/env"}:null}})}));
 vi.stubGlobal("fetch",request);render(<PythonEnvironmentForm onUpdated={onUpdated}/>);
 await waitFor(()=>expect(request).toHaveBeenCalledTimes(1));
 fireEvent.change(screen.getByLabelText("虚拟环境 Python 路径"),{target:{value:"/env/bin/python"}});
 fireEvent.click(screen.getByRole("button",{name:"保存并使用"}));
 await waitFor(()=>expect(onUpdated).toHaveBeenCalledTimes(1));
 expect(request).toHaveBeenLastCalledWith("/api/system/python-environment",expect.objectContaining({method:"PUT",body:JSON.stringify({executable:"/env/bin/python"})}));
});
it("creates an environment with dependency installation as an explicit choice",async()=>{
 const request=vi.fn(async()=>({ok:true,json:async()=>({data:{environment:null}})}));vi.stubGlobal("fetch",request);
 render(<PythonEnvironmentForm onUpdated={async()=>{}}/>);
 fireEvent.click(screen.getByRole("button",{name:"创建专用虚拟环境"}));
 expect(screen.getByLabelText("同时安装公共文档 Skills 依赖")).not.toBeChecked();
 fireEvent.change(screen.getByLabelText("基础 Python 路径（3.10+）"),{target:{value:"/base/python"}});
 fireEvent.click(screen.getByRole("button",{name:"创建并使用"}));
 await waitFor(()=>expect(request).toHaveBeenCalledWith("/api/system/python-environment/create",expect.objectContaining({body:JSON.stringify({baseExecutable:"/base/python",installDocuments:false})})));
});
