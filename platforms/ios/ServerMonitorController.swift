import SwiftUI
import UIKit
import WebKit

/// Hosts the canvas-rendered server monitor inside a `WKWebView`.
///
/// The widget bundle is loaded from the app bundle (`web/index.html`), the data
/// comes either from a direct stream configured in JS or from a snapshot pushed
/// by Swift (`push(snapshot:)`).
@MainActor
final class ServerMonitorController: NSObject, ObservableObject, WKScriptMessageHandler {
    @Published var lastAction: String?

    private var webView: WKWebView?

    /// Builds the configured web view once and keeps the reference.
    func makeWebView() -> WKWebView {
        if let webView { return webView }

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let controller = WKUserContentController()
        // Native → widget and widget → native bridge.
        controller.add(self, name: "widgets")
        configuration.userContentController = controller

        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.15, alpha: 1)
        view.scrollView.contentInsetAdjustmentBehavior = .never

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        webView = view
        return view
    }

    /// Pushes a canonical snapshot JSON produced natively (URLSession, gRPC, cache).
    func push(snapshotJson: String) {
        evaluate("window.__widgets.setSnapshot(\(snapshotJson));")
    }

    /// Applies a partial configuration (theme, source, thresholds…).
    func configure(json: String) {
        evaluate("window.__widgets.setConfig(\(json));")
    }

    func refresh() {
        evaluate("window.__widgets.refresh();")
    }

    /// Stops streaming when the scene goes to the background.
    func stop() {
        evaluate("window.__widgets.stop();")
    }

    func start() {
        evaluate("window.__widgets.start();")
    }

    private func evaluate(_ script: String) {
        webView?.evaluateJavaScript(script) { _, error in
            if let error { print("[widgets] script error: \(error.localizedDescription)") }
        }
    }

    // MARK: - WKScriptMessageHandler

    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "widgets" else { return }
        Task { @MainActor in
            if let dictionary = message.body as? [String: Any],
               let action = dictionary["action"] as? String {
                self.lastAction = action
                self.handle(action: action, payload: dictionary["payload"])
            }
        }
    }

    private func handle(action: String, payload: Any?) {
        switch action {
        case "logs": openLogViewer()
        case "settings": openSettings()
        case "link": openDashboard(payload: payload)
        default: break // forward to analytics/audit if needed
        }
    }

    private func openLogViewer() {}
    private func openSettings() {}
    private func openDashboard(payload: Any?) {}
}

/// SwiftUI wrapper ready to drop into any screen.
struct ServerMonitorWidgetView: UIViewRepresentable {
    @ObservedObject var controller: ServerMonitorController

    func makeUIView(context: Context) -> WKWebView { controller.makeWebView() }
    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: ()) {
        // Detach the message handler so the controller can be released.
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "widgets")
    }
}
