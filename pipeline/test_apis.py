import os
import sys
import asyncio
from dotenv import load_dotenv

# Asegurar que estamos en el directorio correcto
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
load_dotenv()

# Test Supabase
from pipeline.loader import supabase

def test_supabase():
    print("--- 1. Testeando Supabase ---")
    try:
        if not supabase:
            print("❌ Supabase client no inicializado.")
            return False
            
        res = supabase.table("restaurants").select("id").limit(1).execute()
        print("✅ Supabase conectado. Respuesta:", res.data)
        return True
    except Exception as e:
        print(f"❌ Error en Supabase: {e}")
        return False

# Test Gemini
from google import genai
from google.genai import types

def test_gemini(model_name="gemini-1.5-flash"):
    print(f"\n--- 2. Testeando Gemini ({model_name}) ---")
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ GEMINI_API_KEY no encontrado.")
        return False

    api_key = api_key.strip()  # Eliminar posibles espacios extra!
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model_name,
            contents="Responde únicamente con la palabra 'Hola'.",
        )
        print(f"✅ Gemini ({model_name}) respondió: {response.text}")
        return True
    except Exception as e:
        print(f"❌ Error en Gemini ({model_name}): {e}")
        return False

# Test Apify
from apify_client import ApifyClient

def test_apify():
    print("\n--- 3. Testeando Apify ---")
    api_key = os.getenv("APIFY_API_TOKEN")
    if not api_key:
        print("❌ APIFY_API_TOKEN no encontrado.")
        return False

    api_key = api_key.strip()
    try:
        client = ApifyClient(api_key)
        user_info = client.user().get()
        print(f"✅ Apify conectado. Usuario ID: {user_info.get('id')}")
        return True
    except Exception as e:
        print(f"❌ Error en Apify: {e}")
        return False

def test_all_gemini_models():
    models_to_test = [
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-2.5-flash",
    ]
    for m in models_to_test:
        test_gemini(m)

if __name__ == "__main__":
    print("Iniciando tests de APIs...\n")
    test_supabase()
    test_apify()
    test_all_gemini_models()
    print("\nTests finalizados.")
