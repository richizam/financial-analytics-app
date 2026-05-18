# /anomalies

Ejecuta análisis completo de anomalías sobre los datos del período actual.

Pasos:
1. Cargar transacciones del período activo
2. Ejecutar Benford's Law sobre montos
3. Buscar asientos duplicados
4. Detectar outliers por cuenta (método IQR)
5. Aplicar reglas de auditoría automática
6. Retornar score de riesgo global y top 10 hallazgos prioritarios
