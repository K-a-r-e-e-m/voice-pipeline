import urllib.request, json

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

def audit_aws():
    print("=== AUDITING AWS PRICES ===")
    
    # 1. S3 us-east-1
    print("\n--- S3 us-east-1 ---")
    s3_reg = fetch_json('https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/region_index.json')
    s3_url = 'https://pricing.us-east-1.amazonaws.com' + s3_reg['regions']['us-east-1']['currentVersionUrl']
    s3_data = fetch_json(s3_url)
    
    terms = s3_data.get('terms', {}).get('OnDemand', {})
    for sku, prod in s3_data.get('products', {}).items():
        attr = prod.get('attributes', {})
        vtype = attr.get('volumeType')
        pfamily = attr.get('productFamily')
        
        # Storage
        if pfamily == 'Storage' and vtype in ['Standard', 'Standard - Infrequent Access', 'One Zone - Infrequent Access']:
            for tk, tv in terms.get(sku, {}).items():
                for pk, pv in tv.get('priceDimensions', {}).items():
                    print(f"S3 Storage: {vtype} -> {pv.get('pricePerUnit',{}).get('USD')} / {pv.get('unit')} | {pv.get('description')}")
                    
        # Requests & Transitions & Retrieval
        if pfamily in ['Fee', 'Storage Fee', 'Data Transfer']:
            pass
        # Check all price dimensions for keywords
        for tk, tv in terms.get(sku, {}).items():
            for pk, pv in tv.get('priceDimensions', {}).items():
                desc = pv.get('description', '')
                if any(k in desc for k in ['PUT', 'GET, SELECT', 'Lifecycle Transition', 'retrieval', 'Tier 1', 'Tier 2']):
                    if 'Infrequent Access' in desc or 'Standard' in desc:
                        print(f"S3 Op: {pv.get('pricePerUnit',{}).get('USD')} / {pv.get('unit')} | {desc}")

    # 2. EC2 & EBS us-east-1
    print("\n--- EC2 & EBS us-east-1 ---")
    ec2_reg = fetch_json('https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json')
    ec2_url = 'https://pricing.us-east-1.amazonaws.com' + ec2_reg['regions']['us-east-1']['currentVersionUrl']
    print("EC2 us-east-1 URL resolved:", ec2_url)

if __name__ == '__main__':
    audit_aws()
