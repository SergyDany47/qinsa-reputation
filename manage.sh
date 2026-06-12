#!/usr/bin/env bash

# Qinsa Reputation - Server Management Script
# Permite detener procesos atascados o reiniciar los servidores de forma limpia.

function stop_servers() {
    echo "Deteniendo servidores en segundo plano..."
    
    # Matar procesos en el puerto 8000 (Backend FastAPI)
    UVICORN_PIDS=$(lsof -t -i :8000)
    if [ -n "$UVICORN_PIDS" ]; then
        echo "Matando procesos de Backend (PIDs: $UVICORN_PIDS)..."
        echo "$UVICORN_PIDS" | xargs kill -9 2>/dev/null || true
    else
        echo "El Backend no está corriendo en el puerto 8000."
    fi

    # Matar procesos en los puertos 5173 a 5175 (Frontend Vite)
    VITE_PIDS=$(lsof -t -i :5173 -i :5174 -i :5175)
    if [ -n "$VITE_PIDS" ]; then
        echo "Matando procesos de Frontend (PIDs: $VITE_PIDS)..."
        echo "$VITE_PIDS" | xargs kill -9 2>/dev/null || true
    else
        echo "El Frontend no está corriendo en los puertos 5173-5175."
    fi
    
    echo "✅ Servidores detenidos exitosamente."
}

function start_servers() {
    echo "Arrancando servidores de nuevo..."
    ./startup.sh
}

echo "================================================="
echo " Qinsa Reputation - Control de Servidores"
echo "================================================="
echo "1) 🛑 Detener servidores (Libera los puertos 8000 y 5173)"
echo "2) 🔄 Reiniciar servidores (Detiene todo y vuelve a arrancar)"
echo "3) ❌ Salir"
echo "================================================="
read -p "Elige una opción [1-3]: " option

case $option in
    1)
        echo ""
        stop_servers
        ;;
    2)
        echo ""
        stop_servers
        echo ""
        start_servers
        ;;
    3)
        echo ""
        echo "Saliendo..."
        exit 0
        ;;
    *)
        echo "Opción no válida."
        exit 1
        ;;
esac
