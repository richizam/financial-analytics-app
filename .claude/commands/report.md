# /report $tipo $periodo

Genera un informe financiero completo listo para descargar.

Argumentos:
- $tipo: "balance" | "pyg" | "flujo" | "ejecutivo" | "auditoria"
- $periodo: formato YYYY-MM (ej: 2024-12)

Pasos:
1. Validar que existen datos para el período
2. Calcular métricas y comparativos según skill `financial-reports`
3. Generar PDF con @react-pdf/renderer
4. Incluir análisis de anomalías si $tipo = "auditoria"
5. Retornar link de descarga
