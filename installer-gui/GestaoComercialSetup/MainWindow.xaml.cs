using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;

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

    // Linhas de progresso escritas via "Write-Step" no script (prefixo "==> ")
    // -- usadas so pra atualizar o texto da etapa atual, nao tem contagem
    // fixa de passos (varia entre instalacao nova e atualizacao), por isso a
    // barra e indeterminada em vez de mostrar uma porcentagem que seria
    // inventada.
    private const string PrefixoEtapa = "==> ";

    private Process? _processo;
    private readonly StringBuilder _logCompleto = new();
    private bool _ultimaInstalacaoComSucesso;

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
        MostrarTela(TelaProgresso);
        ResetarPainelProgresso();
        IniciarInstalacao();
    }

    private void ResetarPainelProgresso()
    {
        CaixaLog.Clear();
        _logCompleto.Clear();
        TextoEtapaAtual.Text = "Iniciando...";
        CaixaLog.Visibility = Visibility.Collapsed;
        PainelPulso.Visibility = Visibility.Visible;
        BotaoDetalhes.Content = "Ver detalhes ▾";
    }

    private void MostrarTela(FrameworkElement tela)
    {
        TelaBoasVindas.Visibility = ReferenceEquals(tela, TelaBoasVindas) ? Visibility.Visible : Visibility.Collapsed;
        TelaProgresso.Visibility = ReferenceEquals(tela, TelaProgresso) ? Visibility.Visible : Visibility.Collapsed;
        TelaFinal.Visibility = ReferenceEquals(tela, TelaFinal) ? Visibility.Visible : Visibility.Collapsed;
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
            MostrarTelaFinal(sucesso: false, "Nao foi possivel iniciar o processo de instalacao.");
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
            if (linha.StartsWith(PrefixoEtapa, StringComparison.Ordinal))
            {
                TextoEtapaAtual.Text = linha[PrefixoEtapa.Length..].TrimEnd('.');
            }
            AdicionarLinhaLog(linha, ehErro);
        });
    }

    private void AdicionarLinhaLog(string linha, bool ehErro)
    {
        _logCompleto.AppendLine(linha);
        CaixaLog.AppendText(linha + Environment.NewLine);
        CaixaLog.ScrollToEnd();
    }

    private void BotaoDetalhes_Click(object sender, RoutedEventArgs e)
    {
        var mostrando = CaixaLog.Visibility == Visibility.Visible;
        CaixaLog.Visibility = mostrando ? Visibility.Collapsed : Visibility.Visible;
        PainelPulso.Visibility = mostrando ? Visibility.Visible : Visibility.Collapsed;
        BotaoDetalhes.Content = mostrando ? "Ver detalhes ▾" : "Ocultar detalhes ▴";
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
        MostrarTelaFinal(sucesso,
            sucesso
                ? "O sistema esta rodando nesta maquina e pronto pra receber o primeiro cadastro."
                : "A instalacao nao terminou -- veja os detalhes abaixo. Os passos ja concluidos (banco, segredos) nao sao refeitos numa nova tentativa.");
    }

    private void MostrarTelaFinal(bool sucesso, string mensagem)
    {
        _ultimaInstalacaoComSucesso = sucesso;
        MostrarTela(TelaFinal);

        TituloFinal.Text = sucesso ? "Instalacao concluida" : "A instalacao falhou";
        TextoFinal.Text = mensagem;

        var corBadge = sucesso ? "#143D2E" : "#3D1420";
        BadgeFinal.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(corBadge));
        BadgeFinal.Effect = new DropShadowEffect
        {
            Color = Colors.Black,
            Opacity = 0.35,
            BlurRadius = 16,
            ShadowDepth = 4,
        };
        IconeFinal.Text = sucesso ? "✓" : "✕";
        IconeFinal.Foreground = (Brush)FindResource(sucesso ? "CorSucesso" : "CorErro");

        BotaoAcaoFinal.Content = sucesso ? "Abrir o sistema" : "Tentar novamente";
        CaixaLogFinal.Text = _logCompleto.ToString();
    }

    private void BotaoVerLogFinal_Click(object sender, RoutedEventArgs e)
    {
        var mostrando = CaixaLogFinal.Visibility == Visibility.Visible;
        CaixaLogFinal.Visibility = mostrando ? Visibility.Collapsed : Visibility.Visible;
        BotaoVerLog.Content = mostrando ? "Ver detalhes" : "Ocultar detalhes";
    }

    private static readonly string[] CaminhosNavegadorAppMode =
    [
        Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    ];

    private void BotaoAcaoFinal_Click(object sender, RoutedEventArgs e)
    {
        if (_ultimaInstalacaoComSucesso)
        {
            const string url = "http://localhost:8080";
            try
            {
                // --kiosk (nao --app): tela cheia de verdade, sem nenhuma barra de
                // titulo -- --app ainda deixa uma faixa minima com os botoes de
                // minimizar/fechar. Alt+F4 fecha a janela normalmente. Cai pro
                // navegador padrao (com toda a moldura normal) se nenhum dos dois
                // for encontrado.
                var navegador = CaminhosNavegadorAppMode.FirstOrDefault(File.Exists);
                if (navegador is not null)
                {
                    Process.Start(new ProcessStartInfo(navegador) { Arguments = $"--kiosk {url}", UseShellExecute = false });
                }
                else
                {
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                }
            }
            catch
            {
                MessageBox.Show($"Nao foi possivel abrir o navegador -- acesse {url} manualmente.",
                    "Aviso", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        else
        {
            BotaoAcaoFinal_TentarNovamente();
        }
    }

    private void BotaoAcaoFinal_TentarNovamente()
    {
        MostrarTela(TelaProgresso);
        ResetarPainelProgresso();
        IniciarInstalacao();
    }
}
