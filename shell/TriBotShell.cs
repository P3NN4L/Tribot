using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class TriBotShell
{
    private static Process _server;

    [STAThread]
    private static void Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string appDir = Path.Combine(baseDir, "app");
        string node = Path.Combine(baseDir, "runtime", "node.exe");
        if (!File.Exists(node)) node = "node";
        string serverJs = Path.Combine(appDir, "build", "server.cjs");
        if (!File.Exists(serverJs))
        {
            MessageBox.Show("找不到 app/build/server.cjs，请检查安装目录。", "TriBot");
            return;
        }

        int port = FreePort();
        string dataDir = Environment.GetEnvironmentVariable("TRIBOT_DATA_DIR");
        if (string.IsNullOrEmpty(dataDir)) dataDir = Path.Combine(baseDir, "data");
        Directory.CreateDirectory(dataDir);

        var psi = new ProcessStartInfo(node, "\"" + serverJs + "\"");
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.EnvironmentVariables["TRIBOT_PORT"] = port.ToString();
        psi.EnvironmentVariables["TRIBOT_DATA_DIR"] = dataDir;
        psi.EnvironmentVariables["TRIBOT_PACKAGED"] = "1";
        string masterKey = EnsureMasterKey(dataDir);
        if (!string.IsNullOrEmpty(masterKey)) psi.EnvironmentVariables["TRIBOT_MASTER_KEY"] = masterKey;
        try
        {
            _server = Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("启动本地服务失败：" + ex.Message, "TriBot");
            return;
        }

        if (!WaitHealth(port, 25))
        {
            MessageBox.Show("本地服务启动超时。请确认 runtime/node.exe 存在，或查看 data 目录权限。", "TriBot");
            try { if (_server != null) _server.Kill(); } catch { }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var form = new Form();
        form.Text = "TriBot";
        form.Width = 1440;
        form.Height = 920;
        form.MinimumSize = new Size(980, 640);
        form.StartPosition = FormStartPosition.CenterScreen;
        form.BackColor = Color.FromArgb(12, 11, 10);
        string iconPath = Path.Combine(baseDir, "icon.ico");
        if (File.Exists(iconPath)) form.Icon = new Icon(iconPath);

        var web = new WebView2();
        web.Dock = DockStyle.Fill;
        form.Controls.Add(web);

        form.Load += async delegate
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(baseDir, "webview-data"));
                await web.EnsureCoreWebView2Async(env);
                web.Source = new Uri("http://127.0.0.1:" + port + "/?port=" + port);
            }
            catch (Exception ex)
            {
                MessageBox.Show("WebView2 初始化失败：" + ex.Message + "\n请安装 Microsoft Edge WebView2 Runtime。", "TriBot");
            }
        };

        form.FormClosed += delegate
        {
            try { if (_server != null && !_server.HasExited) _server.Kill(); } catch { }
        };

        Application.Run(form);
    }

    private static string EnsureMasterKey(string dataDir)
    {
        try
        {
            string file = Path.Combine(dataDir, ".shellkey");
            byte[] key;
            if (File.Exists(file))
            {
                key = ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser);
            }
            else
            {
                key = new byte[32];
                using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(key);
                File.WriteAllBytes(file, ProtectedData.Protect(key, null, DataProtectionScope.CurrentUser));
            }
            if (key.Length != 32) return null;
            return Convert.ToBase64String(key);
        }
        catch
        {
            return null;
        }
    }

    private static int FreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static bool WaitHealth(int port, int seconds)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                req.Timeout = 1200;
                using (var resp = req.GetResponse()) return true;
            }
            catch
            {
                Thread.Sleep(250);
            }
        }
        return false;
    }
}
