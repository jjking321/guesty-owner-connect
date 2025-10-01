-- Fix function search path security issue by altering the function
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.handle_updated_at() SECURITY DEFINER;