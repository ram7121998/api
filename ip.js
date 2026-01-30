import os from "os";

const interfaces = os.networkInterfaces();

for (const name in interfaces) {
  for (const iface of interfaces[name]) {
    if (iface.family === "IPv4" && !iface.internal) {
      console.log("Server IP:", iface.address);
    }
  }
}
