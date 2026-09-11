using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace GestaoComercialSetup;

public partial class MainWindow : Window
{
    // Sentinelas que Install-GestaoComercial.ps1 escreve no stdout, quando
    // rodado com -NonInteractive, imediatamente antes de bloquear esperando
    // uma linha no stdin. Ver o comentario de -NonInteractive no proprio
    // script para a razao de existirem (garantir que a GUI SEMPRE perceba
    // quando uma resposta e necessaria, mesmo que a checagem previa da GUI
    // tenha "adivinhado errado" se o prompt apareceria).
    private const string SentinelaSenhaPostgres = "__NEED_PG_PASSWORD__";
    private const string SentinelaConfirmacaoRede = "__NEED_NETWORK_CONFIRM__";

    private Process? _processo;

    public MainWindow()
    {
        InitializeComponent();
    }

    private void Cabecalho_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed) DragMove();
    }

    private void Fechar_Click(object sender, RoutedEventArgs e)
    {
        if (_processo is { HasExited: false })
        {
            var resposta = MessageBox.Show(
                "A instalacao ainda esta rodando. Fechar mesmo assim pode deixar o sistema pela metade.",
                "Instalacao em andamento", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (resposta != MessageBoxResult.Yes) return;
            try { _processo.Kill(entireProcessTree: true); } catch { /* melhor esforco */ }
        }
        Close();
    }

    private void BotaoInstalar_Click(object sender, RoutedEventArgs e)
    {
        BotaoInstalar.IsEnabled = false;
        PainelStatusFinal.Visibility = Visibility.Collapsed;
        CaixaLog.Clear();
        IniciarInstalacao();
    }

    private void IniciarInstalacao()
    {
        var baseDir = AppContext.BaseDirectory;
        var scriptPath = Path.Combine(baseDir, "installer", "Install-GestaoComercial.ps1");

        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments =
                $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{scriptPath}\" " +
                $"-AppSourceDir \"{baseDir.TrimEnd('\\')}\" -NonInteractive",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
        };

        _processo = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _processo.OutputDataReceived += (_, args) => ProcessarLinha(args.Data, ehErro: false);
        _processo.ErrorDataReceived += (_, args) => ProcessarLinha(args.Data, ehErro: true);
        _processo.Exited += (_, _) => Dispatcher.Invoke(FinalizarInstalacao);

        try
        {
            _processo.Start();
            _processo.BeginOutputReadLine();
            _processo.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            AdicionarLinhaLog($"Falha ao iniciar o instalador: {ex.Message}", ehErro: true);
            MostrarStatusFinal(sucesso: false, "Nao foi possivel iniciar o processo de instalacao.");
            BotaoInstalar.IsEnabled = true;
        }
    }

    private void ProcessarLinha(string? linha, bool ehErro)
    {
        if (linha is null) return;

        // OutputDataReceived roda numa thread de pool -- toda atualizacao de
        // UI (log, mostrar paineis) precisa ser despachada pra thread da UI.
        Dispatcher.Invoke(() =>
        {
            if (linha.Contains(SentinelaSenhaPostgres))
            {
                PainelSenha.Visibility = Visibility.Visible;
                CampoSenhaPostgres.Focus();
                return;
            }
            if (linha.Contains(SentinelaConfirmacaoRede))
            {
                PainelRede.Visibility = Visibility.Visible;
                return;
            }
            AdicionarLinhaLog(linha, ehErro);
        });
    }

    private void AdicionarLinhaLog(string linha, bool ehErro)
    {
        CaixaLog.AppendText(linha + Environment.NewLine);
        CaixaLog.ScrollToEnd();
        if (ehErro)
        {
            // TextBox nao colore linha a linha sem RichTextBox -- log de erro
            // ja vem prefixado pelo PowerShell (throw/Write-Error), suficiente
            // pra v1; RichTextBox com coloracao por linha fica como melhoria.
        }
    }

    private void CampoSenhaPostgres_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) BotaoConfirmarSenha_Click(sender, e);
    }

    private void BotaoConfirmarSenha_Click(object sender, RoutedEventArgs e)
    {
        if (_processo is null) return;
        var senha = CampoSenhaPostgres.Password;
        EnviarLinhaParaProcesso(senha);
        CampoSenhaPostgres.Clear();
        PainelSenha.Visibility = Visibility.Collapsed;
    }

    private void BotaoRedeSim_Click(object sender, RoutedEventArgs e)
    {
        EnviarLinhaParaProcesso("s");
        PainelRede.Visibility = Visibility.Collapsed;
    }

    private void BotaoRedeNao_Click(object sender, RoutedEventArgs e)
    {
        EnviarLinhaParaProcesso("n");
        PainelRede.Visibility = Visibility.Collapsed;
    }

    private void EnviarLinhaParaProcesso(string linha)
    {
        if (_processo is null) return;
        try
        {
            _processo.StandardInput.WriteLine(linha);
            _processo.StandardInput.Flush();
        }
        catch (Exception ex)
        {
            AdicionarLinhaLog($"Falha ao enviar resposta pro instalador: {ex.Message}", ehErro: true);
        }
    }

    private void FinalizarInstalacao()
    {
        var sucesso = _processo?.ExitCode == 0;
        MostrarStatusFinal(sucesso,
            sucesso
                ? "Instalacao concluida. O sistema esta rodando em http://localhost:8080."
                : "A instalacao falhou -- revise o log acima. Os passos ja concluidos (banco, segredos) nao sao refeitos numa nova tentativa.");
        BotaoInstalar.IsEnabled = true;
        BotaoInstalar.Content = "Tentar novamente";
    }

    private void MostrarStatusFinal(bool sucesso, string mensagem)
    {
        TextoStatusFinal.Text = mensagem;
        PainelStatusFinal.Background = new SolidColorBrush(sucesso
            ? (Color)ColorConverter.ConvertFromString("#143D2E")
            : (Color)ColorConverter.ConvertFromString("#3D1420"));
        TextoStatusFinal.Foreground = (Brush)FindResource(sucesso ? "CorSucesso" : "CorErro");
        PainelStatusFinal.Visibility = Visibility.Visible;
    }
}
